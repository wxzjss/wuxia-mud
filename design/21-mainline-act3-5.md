# 《江湖路远》主线 · 第三~五幕细写（#114）

> 交付人：文策渊（设计+叙事）　任务号：#114　日期：2026-10-11  
> 上位依据：`design/10-mainline-story.md`（**五幕蓝图，必读**）· `design/08-studio-master-plan.md` §3 SPRINT-C  
> 舞台依据：`design/19-map-rebalance.md`（B13 新区块设计，**已落地**）· `design/09-map-district-allocation.md`  
> 人物依据：`design/portraits-new.json`（26 位新画像）· `design/15-portrait-roster.md`  
> 衔接：`design/17-intro-rewrite.md`（楔子，江南大路·老槐树茶摊；**凡人开局；无铜牌·无失忆**）
>
> **本文只出设计。不改代码、不改 `game/data/*.json`、不 commit。** 落地由工程执行。
>
> ---
>
> **本批交付范围**
>
> - **r1**：第三幕＝**可落地细纲**（7 场 + 1 可选行前场，含逐场 effects、Boss `bossPhases` JSON、数据清单）；第四/五幕＝骨架；**§2 冲突与缺口清单 10 条**。
> - **r2（本批）**：主理人已就 **C1–C10 全部拍板**（见 **§2.9**）。本批**按同一规格续写第四、五幕**（逐场 effects + Boss JSON + 三结局与尾声文本），
>   新增 **§8「新增数据总清单」**（三幕并入）与 **§9「给工程的落地清单」**（每条：改哪个文件 / 什么位置 / 什么数据）；
>   并**回填 `design/10-mainline-story.md`**（C8「双修崖」→「绣阁」，并在其 §6 指向本文）。
>
> **id 自查（已跑脚本 · r2 实测数字）**：扫描全文反引号 token 共 **276 项**，其中比中**现存实体**
> （`rooms` / `npcs` / `items` / `quests` / `skills`）或**画像 hook id**（`design/portraits-new.json`）的 **139 项**——
> **「房间 / NPC / 物品 / 任务 / 功法 / 画像钩子」这六类 id，编造数为 0。**
> 其余 137 项经逐条人工判定，全部属于：**新 flag**（本方案提出，§8.6 集中列出）· **引擎关键字 / 字段名**（`menu`/`ending`/`spawn`/`bossPhases`/`cond`/`actions`/`effects`…）· **本方案提议新增的 id**（§8 集中列出）· region 名（`jiangnan`/`huashan`）· 方向键（`w`/`nw`）· 文档引用（`08`）。复现命令见 §附。
>
> **不新增任何房间**（三~五幕全部用现有房间 + 房间 `actions` 实现）→ **不引入新的反向边风险**；
> §1.2 / §4.2 / §5.2 引用的房间**全部通过严格反向边**（`A.d→B ⇒ B.opp→A`）。唯一例外是 **C9 第一幕夜戏**：挂在现有房间 `road_huashan_1`（华山道·山脚）上，**同样不新增房间**。

---

## 0. 一句话定位

| 幕        | 一句话                                                  | 推翻上一幕的哪件事                        | 落点 flag             |
| -------- | ---------------------------------------------------- | -------------------------------- | ------------------- |
| 三 · 伪秘籍  | 你去北疆取一卷真东西，却在星宿海发现**有人正在批量生产假东西**——假秘籍是钩子，练坏的人是"实证"。 | 二幕说「门派里有内鬼」；三幕说**连你练的东西都可能是假的**。 | `know_zhenyi`       |
| 四 · 黑木之崖 | 你打穿了黑木崖三道哨卡，却听东方不败说：**「收秘典的不是我。」**                   | 三幕说「秘籍被做了手脚」；四幕说**做手脚的人不在江湖里**。  | `know_depot_master` |
| 五 · 江湖路远 | 残卷在手，朝堂的门开了。**交、不交、半交——三条路都不是好结局。**                  | 四幕说「敌人在朝堂」；五幕说**赢了也没有答案**。       | `ending_*`          |

## 0.1 「拉回路径」总表（全剧 **7 条**，全部非战斗，全部取材于现成画像）

> 任务要求"主线里真的用上至少 3 个"。本方案用 **7 个**，分布在三幕。  
> **口径**：拉回 = 执行画像 `arc.warm` 的正向动作；堕落 = 执行 `arc.break`。

| # | 幕 | 人物（真实 id）      | 舞台（room id）                                      | **拉回动作**（`arc.warm`） | 拉回后给什么                              | 堕落（`arc.break`）的代价                                |
| - | - | -------------- | ------------------------------------------------ | -------------------- | ----------------------------------- | ------------------------------------------------- |
| 1 | 三 | `npcv_180` 乐知  | `jn_market_main`                                 | 在她面前不提华山 / 替她挡回岳不群的话 | `yue_zhi_road` 北线小路 → 3-2 **免一战**   | 抖出当年丢镖：`+money`，小路永不可得                            |
| 2 | 三 | `npcv_252` 陈语冰 | `jn_brothel_room`                                | 不在她面前提梅拾 / 听她唱完一段曲   | `chen_chaoben` 抄本流向 → **"半交"结局必需物** | 告诉梅拾：她被处置，**"半交"永久锁死**                            |
| 3 | 三 | `npcv_090` 阮听  | `jn_fruit_stall`                                 | 替他跑一趟星宿海 / 不问他的箱子    | `ruan_cure` 解药 → 3-7 Boss 减负        | 说给毛清：`+money`，解药断                                 |
| 4 | 三 | `npcv_248` 俞初  | `road_xixia_1`                                   | **不替常拂说话** / 送她好香    | `yu_ledger` 假账册 → 3-7 取证快一格         | **替常拂翻案**：`+karma` 但毁掉她，改走 `npcv_049` 关外线（慢、官面转冷） |
| 5 | 四 | `npcv_164` 皮朝颜 | `mojiao_shanmen`                                 | 替她查清那笔周转银子 / 不提"枯井"  | 黑木崖**后山暗道** → 少打一道哨卡                | 把死人账捅给教外：暗道断                                      |
| 6 | 四 | `npcv_186` 鲁半夏 | （引至 `mojiao_shanmen`，其 room 在 `jn_brothel_hall`） | 不提日月神教 / 替她带胭脂       | **绣阁布防** → 4-2 提前知东方不败伤处            | 告诉东方不败：布防情报断，4-2 更凶险                              |
| 7 | 五 | `npcv_082` 夏承志 | `palace_prison`                                  | 替他瞒下递消息的事 / 替元怀瑾挡话   | **御道·天牢门禁 + 一块内府腰牌**（解决 C7）         | 替他向东厂递一句真话：腰牌线断                                   |

> **设计意图**：7 条里 **5 条**（#1 #3 #5 #7 + #2 的副作用）都在**非剧情 NPC** 身上——他们不是 Boss、不是委托人，  
> 是"江湖里的人"。**主线因此有了"人味"，而画像里写好的钩子也不再有"写完了没人碰"的浪费。**

---

# 1. 前置核对（实测，非估计）

> 全部数字来自 `new GameEngine({seed:20261010}).boot()` 与 `game/data/50_map.json` 实读。命令见 §附。

## 1.1 版本基准

| 口径                              | 房间      | region | 说明                                               |
| ------------------------------- | ------- | ------ | ------------------------------------------------ |
| `game/data/50_map.json`（**规范**） | **312** | **34** | B13 重设计**已落地**（291 → 312），`jiangnan` 56 → **27** |
| 引擎合并后（含 demo/mod）               | 317     | 35     | 多 `tingyu` 4 房（demo，勿动）+ `test_room` 1 房（建议删）    |

**结论：B13 的迁移已完成**（`jn_home_02..30` 已删、24 座新宅已入洛阳/长安/成都/襄阳/码头/姑苏/衙门府、`beijiang_shankou`/`beijiang_houzhai`/`xiyu_shule` 等 20 间补建房已存在）。**主线三~五幕的舞台按新布局写，无需等待。**

## 1.2 本剧三~五幕用到的真实房间（已逐条核对出口 + 严格反向边）

| 幕 | room id                                                 | 名字        | region                    | 出口                          | 反向边               |
| - | ------------------------------------------------------- | --------- | ------------------------- | --------------------------- | ----------------- |
| 三 | `shaolin_daxiong`                                       | 少林·大雄宝殿   | shaolin                   | s/n/w                       | ✅                 |
| 三 | `shaolin_cangjing`                                      | 少林·藏经阁    | shaolin                   | e/n/w（n→`hm_npcv_024`）      | ✅                 |
| 三 | `road_beijiang_1`                                       | 塞外风沙      | beijiang                  | e/n/w/s/ne                  | ✅                 |
| 三 | `beijiang_shankou`                                      | 雪谷·山口     | beijiang                  | sw（**单出口**）                 | ✅                 |
| 三 | `beijiang_xuedao`                                       | 血刀门·前庭    | beijiang                  | s/n/e（n→`hm_blood_saber`）   | ✅                 |
| 三 | `beijiang_houzhai`                                      | 血刀寨·后寨    | beijiang                  | w（**单出口**）                  | ✅                 |
| 三 | `hm_blood_saber`                                        | 血刀老祖的家    | beijiang                  | s                           | ✅（`private:true`） |
| 三 | `road_xiyu_1`                                           | 西域古道      | xiyu                      | e/w/s/ne/n                  | ✅                 |
| 三 | `xiyu_shule`                                            | 西域·疏勒镇    | xiyu                      | s                           | ✅                 |
| 三 | `xiyu_oasis`                                            | 西域·绿洲     | xiyu                      | e/w/n                       | ✅                 |
| 三 | `xiyu_xingxiu`                                          | 星宿海       | xiyu                      | e/n（n→`hm_xingxiu_laoxian`） | ✅                 |
| 三 | `road_xixia_1`                                          | 西夏官道      | xixia                     | n/w/s/e                     | ✅                 |
| 三 | `xixia_yanchang`                                        | 西夏·盐场     | xixia                     | w                           | ✅                 |
| 三 | `xixia_ice`                                             | 西夏·冰窖     | xixia                     | n                           | ✅                 |
| 三 | `jn_market_main` / `jn_brothel_room` / `jn_fruit_stall` | 江南行前场     | market / qinglou / market | —                           | ✅                 |
| 四 | `mojiao_shanmen`                                        | 黑木崖·山门    | mojiao                    | n/u/s                       | ✅                 |
| 四 | `mojiao_hall`                                           | 黑木崖·大殿    | mojiao                    | d/n                         | ✅                 |
| 四 | `mojiao_shuangxiu`                                      | 黑木崖·绣阁    | mojiao                    | s（**单出口**）                  | ✅                 |
| 四 | `jiangnan_east_road`                                    | 城东官道（上崖路） | jiangnan                  | w/e/s/n                     | ✅                 |
| 五 | `palace_street`                                         | 皇城·御街     | jiangnan                  | n/e                         | ✅                 |
| 五 | `palace_gate`                                           | 皇城·午门     | palace                    | w/**e(cond)**/s             | ⚠ 见 §2-C7         |
| 五 | `palace_road`                                           | 皇城·御道     | palace                    | e                           | ✅                 |
| 五 | `palace_plaza`                                          | 皇城·金水桥    | palace                    | w/e                         | ✅                 |
| 五 | `palace_hall`                                           | 皇城·太和殿    | palace                    | w/nw(cond)/e/ne             | ✅                 |
| 五 | `palace_prison`                                         | 皇城·天牢     | palace                    | se                          | ✅                 |
| 五 | `taohuadao_dock`                                        | 桃花岛·渡口    | taohuadao                 | n/w                         | ✅                 |
| 五 | `taohuadao_forest`                                      | 桃花岛·桃林    | taohuadao                 | s/n/e                       | ✅                 |
| 五 | `taohuadao_she`                                         | 桃花岛·蛇阵    | taohuadao                 | w                           | ✅                 |
| 五 | `taohuadao_qingyin`                                     | 桃花岛·清音洞   | taohuadao                 | s/n/w（w→`hm_nv_huang`）      | ✅                 |
| 五 | `haitan_boat`                                           | 东海·渔船     | haitan                    | w/e（e→桃花岛渡口）                | ✅                 |

> ✅ 上表房间**全部存在，且严格反向边一致**（`A.d→B ⇒ B.opp→A`）。B13 的 R5「严格反向边假绿」在这批房间里**未复现**。  
> ⚠ 全图仍有 `palace_gate.e` 这类 **cond 对象边**（`{to,cond,msg,travel}`）——**写门禁时要用对象形式，不能写字符串**（见 §2-C7）。

## 1.3 本剧关键 NPC（真实 id）

| id                  | 名字   | 身份     | room                | tier | 备注                                                                    |
| ------------------- | ---- | ------ | ------------------- | ---- | --------------------------------------------------------------------- |
| `wudang_chongxu`    | 冲虚道长 | 武当掌门   | `wudang_zixiao`     | A    | 一、二幕委托人                                                               |
| `shaolin_fangzheng` | 方证大师 | 少林方丈   | `shaolin_daxiong`   | A    | 二幕遭遇 + **三幕委托人（见 C10）**                                               |
| `blood_saber`       | 血刀老祖 | 血刀门主   | `beijiang_xuedao`   | A    | hp 4600 · `hostile:true` · **无 bossPhases（C6）**                       |
| `xingxiu_laoxian`   | 丁春秋  | 星宿老仙   | `xiyu_xingxiu`      | A    | hp 4000 · `hostile:true` · **无 bossPhases（C6）**                       |
| `mojiao_dongfang`   | 东方不败 | 日月神教教主 | `mojiao_shuangxiu`  | A    | hp 7000 · **bossPhases 已完整（3 阶段）**                                    |
| `nv_huang`          | 黄药师  | 东邪     | `taohuadao_qingyin` | A    | hp 5200 · `hostile:false` · 挂 `q_taohua_entry` · **无 bossPhases（C6）** |
| `depot_master`      | 冯保   | 东厂提督   | `palace_hall`       | A    | hp 7200 · **bossPhases 已完整（绣春刀/影卫/圣旨 + summon `depot_shadow`）**       |
| `depot_shadow`      | 影子   | 影卫首领   | `palace_road`       | A    | hp 4200 · **bossPhases 2 阶段**                                         |
| `bureau_clerk`      | 胡录事  | 书吏     | `jn_yamen_office`   | B    | 二幕已用                                                                  |
| `mob_mo_disciple`   | 魔教教众 | —      | (null)              | —    | lv21，**召唤可用**                                                         |
| `mob_bandit_chief`  | 山贼首领 | —      | (null)              | —    | lv13，**召唤可用**                                                         |
| `mob_assassin`      | 黑衣人  | —      | (null)              | —    | lv33，可作三幕追踪者                                                          |

**三幕舞台现驻 NPC**（可用于支线接口与"群众"）：

- 北疆（5）：`blood_saber`(血刀老祖) · `npcv_067`(狄知) · `npcv_141`(马秋) · `npcv_212`(华云) · `npcv_288`(尹伯)
- 西域（5）：`xingxiu_laoxian`(丁春秋) · `npcv_044`(田苇航) · `npcv_068`(贝仲卿) · `npcv_145`(邬灵) · `npcv_213`(昌从简)
- 西夏（4）：`npcv_049`(常拂) · `npcv_071`(萧初) · `npcv_222`(陈拾) · `npcv_248`(俞初)
- 少林（22）：含 `shaolin_fangzheng` · `shenni`(神秘老僧) · `npcv_024`(蒋停舟，藏经阁后) 等
- 黑木崖（6）：`mojiao_dongfang` · `npcv_053`(禹清) · `npcv_119`(蔡落) · `npcv_164`(皮朝颜) · `npcv_185`(元明月) · `npcv_251`(田绿)
- 皇城（26）：含 `depot_master` · `depot_shadow` · `npcv_082`(夏承志，天牢捕快) 等
- 桃花岛（9）：`nv_huang` · `npcv_046`(雷白露) 等

## 1.4 引擎能力清单（决定了剧情怎么写才落地得了）

| 能力              | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 依据                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 剧情入口            | **房间 `actions`**（`{cmd,label,keywords,cond,failMsg,effects[]}`，全图 102 处）                                                                                                                                                                                                                                                                                                                                                                                        | 二幕 6 个入口同款                        |
| effect 全表       | `narrate/say/me/log/warn/hint/favor/dialog/ask` · `flag/unflag/toggleflag/var/incvar/decvar` · `+item/-item/randomitem/+equip` · `+exp/+pot/+money/+title/+trait/+perk/+buff/+karma/+rep/+kill/+attr` · `+skill/learnskill/learn/forgetskill` · `goto/move/teleport/spawn/despawn` · `quest/questdone/questfail` · `combat/fight/combatWith/die/damage/sethp/heal/fullheal` · **`menu`** · **`ending`** · `joinSect/leaveSect/promote/sleep/wait/sound/call/fn` | `game/src/core/modapi.js:374-590` |
| **抉择**          | **`menu`**：`raw = "标题\|选项A>效果A;;选项B>效果B"`（选项可挂任意 effect）                                                                                                                                                                                                                                                                                                                                                                                                        | `modapi.js:542-554`               |
| **结局**          | **`ending`**：`{type:'ending',args:['jiaojuan','交了卷']}` → 置 `ending_jiaojuan` flag + `var ending`，UI 弹终章框（`ui.js:2179-2187`）                                                                                                                                                                                                                                                                                                                                     | `modapi.js:565-570`               |
| **临时登场**        | **`spawn`/`despawn`**：`{type:'spawn',args:['depot_shadow','mojiao_shuangxiu']}`——**这就是"影子追到北疆""冯保亲至黑木崖"的实现方式**                                                                                                                                                                                                                                                                                                                                                  | `modapi.js:487-488`               |
| Boss 三阶段        | `bossPhases: [{at, name, skill, line, desc, mult{}, summon{npc,count}}]`，`at` 必须递减，phase0 的 skill 会自动预挂                                                                                                                                                                                                                                                                                                                                                         | `combat.js:216-283`               |
| `mult` 可用的键     | `atk/def/dodge/speed`（**倍率**）+ `reflect/lifesteal/armorPen/critRate`（**绝对值**，因基线为 0）                                                                                                                                                                                                                                                                                                                                                                            | `combat.js:249-266`               |
| **`lifesteal`** | **存在**——蓝图里的「化血/化功（吸内）」可以直接写 `{"lifesteal":0.3}`                                                                                                                                                                                                                                                                                                                                                                                                                | 同上                                |
| **不可用**         | **"逃跑后重召"**（`血遁` 原义）无引擎支持；`hostile:true` 的 NPC **不能 `talk`**（`commands.js:950/1644`），所以 Boss 的对话/交易必须走**房间 action**                                                                                                                                                                                                                                                                                                                                             | —                                 |

## 1.5 既有主线数据（第三幕必须接得上）

| 任务                       | giver            | 段数 | 末段 cond                       | rewards 落                                                                                                               |
| ------------------------ | ---------------- | -- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `q_main_jianghu`【主线】江湖路远 | 无（靠 `npc` 挂）     | 6  | 无 cond（`next:99`）             | `+title 天下第一` · **`ending: jianghu_end`** · **`flag know_east_depot`** · **`+item depot_token_half`** · 接 `q_main_sect` |
| `q_main_sect`【主线】门派之疑    | `wudang_chongxu` | 7  | `flag know_xuemao`（`next:99`） | `flag act2_done` · `flag sect_ashamed`                                                                                  |

`q_main_jianghu` 各段 cond：① `hasSect` ② `fn anySkill100` ③ `fn sideQuestsDone(5)` ④ **`fn defeatLegend`** ⑤ `flagsAny learned_jiuyang/jiuyin/yijinjing/sunflower` ⑥ 无。

**flag 链（三幕入场）**：`act2_done` + `sect_ashamed` + `know_xuemao` → **第三幕 `q_main_snow` 起点**。  
**第一幕幕末实际发生在哪**：`know_east_depot` 与 `depot_token_half` 都由 `q_main_jianghu` 的 **rewards** 发出（`60_quests.json:1168 / 1176+`），配一句旁白。**没有任何可玩的"夜戏·救人·塞铜牌"场景**（见 §2-C9）。

---

# 2. ⚠️ 冲突与缺口清单（**请先读这一节**）

> 这三条会**直接卡住落地**：**C1 / C5 / C6**。  
> 每条给：现象 → 证据（文件:行）→ 影响 → 建议改法 → 归属。

### C1 🔴【高】`defeatLegend` 的判定池里，装着第四幕的 Boss 和第三/五幕的委托人

- **现象**：第一/二幕的通行证要求「击败一位绝世高手」，而池子是  
  `['mojiao_dongfang','blood_saber','xingxiu_laoxian','shaolin_fangzheng','emei_miejue','nv_huang']`。  
  其中 `mojiao_dongfang`（**第四幕 Boss**）、`blood_saber`/`xingxiu_laoxian`（**第三幕 Boss**）都在内；  
  `shaolin_fangzheng`（**第三幕委托人**）、`nv_huang`（**第五幕委托人**）也在内。
- **证据**：`game/src/core/engine.js:63-66`；`game/data/60_quests.json`（`q_main_jianghu` stage3 `desc` 只写了 4 人：东方不败/血刀老祖/丁春秋/方证大师 —— **描述与代码不一致**）。
- **影响**：玩家完全可能在第一幕就"击败东方不败"，那么第四幕 `4-3` 的 Boss 战变成打一具尸体；同理第三幕的委托人与 Boss 也可能已经死。这正是蓝图 §0 为选冲虚当委托人而专门规避的问题——现在从侧门回来了。
- **建议改法（推荐 A）**：把 `defeatLegend` 的池改为**与主线委托人/Boss 无交集**的 A 层高手，例如  
  `['emei_miejue','taixu_hermit','shenni']`（灭绝师太 / 太虚居士 / 神秘老僧，均为真实存在的 A 层 NPC，且**不担任任何幕的委托人**），  
  并把 `q_main_jianghu` stage3 的 `desc` 同步改成这三人。  
  **备选 B（更省事但更松）**：把判定改成"击败任意一位 A 层 NPC"（遍历 `killed_*` 是否命中任 A 层 id），彻底解绑名单。
- **归属**：工程（`engine.js` 一行 + `60_quests.json` 文案）。**需主人拍板选 A 还是 B。**


### C2 🔴【高】旧主线自带 `ending: jianghu_end`，与三结局冲突

- **现象**：`q_main_jianghu` 完成即写入 `ending_jianghu_end` + `var ending='jianghu_end'`，UI 会弹"故事终章"框。
- **证据**：`game/data/60_quests.json:1153-1158`。
- **影响**：**玩家在第一幕就会看到"终章"弹窗**（因为 `q_main_jianghu` 是前两幕的通行证）。五幕的"三结局"根本没有出场机会。
- **建议改法**：① 把 `q_main_jianghu` rewards 里的 `ending` 效果**移除**或改为普通 narrate；② 三结局统一由 `q_main_end`（第五幕）用 `menu` + `ending` 产出（见 §6）。
- **归属**：工程 + 数据。

### C3 🟡【中】「习得绝顶内功」被当成第一/二幕门槛，破坏了"变强"的爬坡

- **现象**：前两幕的通行证要求已习得 `jiuyang_shengong / jiuyin_zhenjing / yijinjing / sunflower_manual` 之一。
- **证据**：`60_quests.json`（`q_main_jianghu` stage 5 `flagsAny`）。
- **影响**：玩家在**进第三幕之前就已经是顶级内力**，则第三幕"练了假秘籍会伤身"的恐惧、第四幕东方不败的压迫感都会失效（假秘籍的诱惑力 = 你现在还不够强）。
- **建议改法**：把 stage 5 的 cond 从"**已习得**绝顶内功"改为「**武学总熟练度 ≥ N**」或「任一武学 ≥ 200（而非 100）」，把"习得绝学"变成**第四幕之后**的目标。**最小改法**：stage 4/5 各加一个前置于第四幕的 flag（如 `flag act4_done`），把这两段整体后移到第四幕之后结算。
- **归属**：工程 + 数值（可与 `design/05-balance-spec.md` 一起定）。

### C4 🟠【中】蓝图第四幕的 `任我行` 在数据里不存在

- **现象**：`design/10-mainline-story.md` §2 节点 4-4「任我行」、§3 无其事；全库 NPC 无此人（也 `向问天/童百熊` 皆无）。
- **证据**：实测 `Object.keys(npcs).filter(name.includes('任我行'))` → 空。
- **影响**：第四幕 4-4 的"第二个幕后黑手"无法落地。
- **建议改法（三选一，请主人定）**：
  - **(a)** 新增 NPC `ren_woxing`（名称"任我行"，tier A，`room: mojiao_hall`，带 portrait + bossPhases）——**推荐**（蓝图原有设计）。
  - **(b)** 把 4-4 改为**已有的东方不败独白**承担（"收秘典的不止一家"，省一个 NPC），代价是第四幕少一个层次。
  - **(c)** 换成已有的 `mob_mo_disciple` 首领不明、或以 `皮朝颜(npcv_164)` 的"死人账"牵出——**不推荐**（火力不足）。
- **归属**：数据（新增 NPC）。**本文第四幕骨架按 (a) 写，若选 (b)(c) 我改 §4。**

### C5 🔴【高】《武林真意》残卷 —— 全剧核心道具**不存在**

- **现象**：第四幕 4-5 要拿到《武林真意》残卷，第五幕三结局全靠它。全库物品里**没有**这件东西。
- **证据**：`Object.keys(items)` 无 `zhenyi`/`canjuan`；`book_poem`（诗集残卷）是另一件。现有 `depot_token_half`（半块东厂铜牌）/ `xunchun_blade`（绣春刀）/ `brocade_robe`（织金蟒袍）✅ 都在。
- **影响**：第四幕高潮与第五幕全部分歧**无法落地**。
- **建议**：新增物品 **`wulin_zhenyi_canjuan`（武林真意·残卷）**，`type:'book'`/`'quest'`、`noSell:true`、`tags:['mainline','clue','legend']`、`quality:'legend'`、`desc` 强调"残缺，只够看半篇"。另建议新增 `wulin_zhenyi_chaoben`（抄本）作为"半交"结局必需物。
- **归属**：数据（新增物品）。

### C6 🔴【高】三个 Boss 没有 `bossPhases`，且缺少量素材

- **现象**：`blood_saber` / `xingxiu_laoxian` / `nv_huang` **均无 `bossPhases`**（现有 3 个：东方不败 / 冯保 / 影子）。
- **证据**：实测 `Object.keys(npcs).filter(id => npcs[id].bossPhases)` → 只有那 3 个。
- **素材缺口**：
  | 蓝图招式            | 现有 skill?                               | 处理                                                         |
  | --------------- | --------------------------------------- | ---------------------------------------------------------- |
  | 刀血 / 化血（血刀老祖）   | `xuedao`(血刀刀法) ✅                        | 化血 → `mult:{lifesteal:0.3}` ✅ 引擎支持                         |
  | 血遁（逃跑重召）        | ❌ 引擎不支持逃走重召                             | **改为**：不换招 + `dodge/speed` 抬升 + `summon` 两名刀客（语义="他退到人后面"） |
  | 毒雾 / 化功（丁春秋）    | `tangmen_du`(唐门毒术) ✅ / `cuixin_zhang` ✅ | 化功 → `mult:{lifesteal:0.35}` ✅                             |
  | 诡计（召唤弟子）        | ❌ 无星宿弟子 mob                             | **复用 `mob_mo_disciple`（邪派教众）**，或新增 `mob_xingxiu_dizi`      |
  | 落英神剑掌（黄药师 100%） | ❌ 无                                     | **新增 skill `luoying_shenjian_zhang`**（或降级用 `taixu_jianyi`） |
  | 旋风扫（黄药师 60%）    | `kuangfeng_daofa` ✅（名称不同）               | 复用                                                         |
  | 移步（黄药师 30%）     | ❌ 无 skill                               | 用 `mult:{dodge,speed}`（同东方不败 30% 写法）✅                      |
- **影响**：第三幕两场 Boss 战、第五幕一场 Boss 战无法演出。
- **建议**：采用本文 §3.4 给出的**完整 `bossPhases` JSON**（已按引擎能力写成可粘贴形态，含 `lifesteal` 与 `summon`）。
- **归属**：数据（3 个 NPC 加字段）+ 可选新增 1 skill。

### C7 🟠【中】`palace_token`（内府腰牌）**没有任何获取途径** —— 第五幕进不去皇城

- **现象**：`palace_gate` 的东出口是 cond 边：无腰牌则"午门不开"；`palace_hall` 通往天牢的 `nw` 也需腰牌。
- **证据**：`game/data/50_map.json:3956 / 4020`（两处 `cond.item = palace_token`）；`20_items.json:1678`（物品定义存在）；**全库无任何 effect 发出该物品**。
- **影响**：第五幕终局在 `palace_hall`，**玩家目前物理上进不去**（只能走到午门被拦）。
- **建议**：第五幕开场给一条**明确的腰牌来路**（本文 §5 已设计三条，任选其一或全给）：  
  ① 应召进京线：`palace_street` 收到"请你进京"的公文时，随文给牌；  
  ② 胡录事线：`bureau_clerk` 帮你"补一个差役的名分"→ 给牌（需二幕 `clerk_met`）；  
  ③ 天牢线：`npcv_082`（夏承志）的拉回路径给牌（见 §5.3）。
- **归属**：数据（新增 effect 发出）+ 本文设计。

### C8 🟡【低·命名】蓝图里的「**双修崖**」与房间名「黑木崖·绣阁」不一致

- **现象**：三幕幕末信写「残卷在双修崖，请东方教主亲自验收」；但地图上东方不败在 `mojiao_shuangxiu`「黑木崖·绣阁」（`design/10` §3 巢穴也是 `mojiao_shuangxiu`）。
- **影响**：玩家读信后按"双修崖"找路会找不到。
- **建议**：**统一为"绣阁"**（房间名已经是绣阁），信文改为「残卷在绣阁」；或把房间改名为"黑木崖·双修崖"（不推荐，动地图 id 风险）。**本文按"绣阁"写。**
- **归属**：本文（已处理）+ 蓝图 `design/10` 需回填一处。

### C9 🟠【中】第一幕的转折（1-5/1-6 夜戏·救人·塞铜牌）**没有可玩场景**

- **现象**：`know_east_depot` 与 `depot_token_half` 都是在 `q_main_jianghu` 完成时**由 rewards 直接发出**，配两句旁白（"那名将死之人塞给你的半块铜牌，还带着他掌心的汗。"）。
- **证据**：`60_quests.json:1168`（flag）+ 其后的 `+item depot_token_half`；全库无 action 置 `know_east_depot`。
- **影响**：第一幕的**幕末转折只是一段奖励文案**，玩家没有"救了一个不该救的人"的经历——而这正是全剧的动机起点，也是第五幕"你救的人"能否回来的伏笔。
- **建议**：把 1-5/1-6 补成一个**可玩夜戏**（房间 action，建议挂在 `road_huashan_1` 或 `jiangnan_west_road`，cond `fn anySkill100`），并把 rewards 里的 flag/item 改为由该场景发出。**这是第一幕的事，不在本次范围，但会直接影响第三幕的动机链，故列出。**
- **归属**：第一幕补写（建议单开一个任务）。

### C10 🟡【低·需知悉】方证大师的"三重身份"

- **现象**：`shaolin_fangzheng` 同时是 ① `q_main_sect` 的对话对象（问默契）② `defeatLegend` 池成员（可被击败）③ 蓝图指定的**第三幕委托人**。
- **影响**：若不做 C1 的收窄，玩家可能在"问他"之前就"打了他"。即便做了 C1，也建议第三幕的方证台词**写成容错**（不假设他一定没被打过）。
- **建议**：C1 采纳后本条自动缓解；本文 §3.1 的台词**已按"不假设玩家与他交过手"写成容错**。
- **归属**：本文（已处理）+ C1。

---

## 2.9 主理人决定与落地口径（**C1–C10 已全部拍板 · 工程照此做**）

| # | 决定 | 落地位置 / 数据 | 备注 |
|---|---|---|---|
| **C1** | **采用方案 A**：`defeatLegend` 池换为 **`emei_miejue` / `taixu_hermit` / `shenni`**（灭绝师太 / 太虚居士 / 神秘老僧） | `game/src/core/engine.js:63-66` 的数组；同时改 `game/data/60_quests.json` 里 `q_main_jianghu` stage3 的 `desc`（**代码 6 人 vs 描述 4 人的不一致一并修**） | 三人都真实存在（`emei_miejue` hp4800 · `taixu_hermit` hp2600 · `shenni` hp12000），**且都不担任任何幕的委托人** |
| **C2** | **修**：摘掉第一幕的 `ending: jianghu_end` | `game/data/60_quests.json`（`q_main_jianghu.rewards` 里的 `{"type":"ending","args":["jianghu_end","江湖路远"]}`，即 **:1153-1158**）→ **删除该条**，改为一条 `narrate`（见下方"第一幕新收尾"） | 真正终章**只能在第五幕**结算（`q_main_end`） |
| **C3** | **后移**：前两幕"习得绝顶内功"门槛整体挪到**第四幕之后** | `game/data/60_quests.json`（`q_main_jianghu` stage 4/5 的 `cond`）+ **`design/05-balance-spec.md`** 同步 | **详述见 §2.9.1（力量曲线连锁反应）** |
| **C4** | **新增 NPC `ren_woxing`（任我行）** | `game/data/40_npcs.json` + portrait；数据规格见 **§8** | 第四幕 4-4 用 |
| **C5** | **批准新增** `wulin_zhenyi_canjuan`（武林真意·残卷）+ `wulin_zhenyi_chaoben`（抄本） | `game/data/20_items.json`；规格见 **§8** | 四幕高潮 + 三结局全靠它 |
| **C6** | **用本文给的可粘贴 `bossPhases`**；「血遁」改「退后 + 召两名刀客」的语义等价写法 | `game/data/40_npcs.json` 的 `blood_saber` / `xingxiu_laoxian` / `nv_huang` 三个模板；可选新增 skill `luoying_shenjian_zhang` | 三份 JSON 见 §3.4 与 §4.4 / §5.4。**其中 `nv_huang` 的"可选切磋彩蛋"主理人已定：默认否**——理由是本文自己查出来的那条：**他是第五幕委托人，让他当 Boss 就重演蓝图 §0 专门规避的"打自己的委托人"**；JSON 保留标注"需要时再启" |
| **C7** | **批准三条腰牌来路**（应召线 / 胡录事线 / `npcv_082` 拉回线） | 第五幕 5-1；数据规格见 **§5.3 与 §8** | 不新增物品（`palace_token` 已存在） |
| **C8** | **统一为「绣阁」** | 本文已统一；`design/10-mainline-story.md` 那一处**由叙事侧回填**（已做） | 房间 `mojiao_shuangxiu` 名"黑木崖·绣阁"，**不动地图** |
| **C9** | **补**：第一幕「夜戏·救人·塞铜牌」做成可玩场景 | 现有房间 **`road_huashan_1`**（华山道·山脚）的新 `action`；**不新增房间** | **详述见 §2.9.2（接口表）** |
| **C10** | 容错写法可 | 本文 §3.1 方证台词已按容错写 | — |

### 2.9.1 【C3 详述】把"绝顶内功"门槛后移 —— 移到哪、以及力量曲线的连锁反应

**现状**（`q_main_jianghu` stage 4/5）：

| 原 stage | 原 cond | 问题 |
|---|---|---|
| 4 | `fn defeatLegend`（击败一位名宿） | 位置合理（一幕真打一场），但**池子含未来 Boss**（C1 已修） |
| 5 | `flagsAny: learned_jiuyang_shengong / learned_jiuyin_zhenjing / learned_yijinjing / learned_sunflower_manual` | **要求"已习得九阳/九阴/易筋经/葵花宝典之一"** |

**问题链**：这一条是 `q_main_jianghu` 的**通行证**，而 `q_main_jianghu` 一完成就发 `know_east_depot` + 铜牌 + 接二幕。
所以合起来的实际时序是：**玩家在进第三幕之前，就已经拥有绝顶内功**。于是——
1. **第三幕的"假秘籍"失去诱惑力**：丁春秋的卖点是「别人练三十年，我这儿七天」。可玩家现在**比三十年还高**，凭什么心动？
2. **第四幕东方不败失去压迫感**：一个已经会《九阳/九阴/葵花》的人，打赢 hp7000 的绣阁主人只是时间问题。
3. **第五幕黄药师的"三家之言"落空**：他要说的三句话里有一句是"你练的是假的东西"——**如果玩家从没碰过假东西，这句话就没有落点**。

**建议改法（最小改动，且不新增关卡）**：

| 改哪 | 从 | 改为 |
|---|---|---|
| `q_main_jianghu` **stage 4**（击败名宿） | `cond: {fn:'defeatLegend'}` | `cond: {and:[{fn:'defeatLegend'}, {flag:'act4_done'}]}` —— **移到第四幕之后结算** |
| `q_main_jianghu` **stage 5**（习得绝顶内功） | `flagsAny learned_*` | 保留条件，但同样**排在 `act4_done` 之后**（stage 4 已挡，stage 5 自然靠后） |
| `q_main_jianghu` 的**语序** | 幕末（发铜牌） | **不变**——但 stage 4/5 现在"悬在最后"，玩家进三幕不再被它们卡住 |

> ⚠️ **一个必须说清的副作用**：`q_main_jianghu` 的 rewards 才是**发铜牌 + `know_east_depot`** 的地方（C2/C9 相关）。
> 若把 stage 4/5 推到第四幕之后，则 **stage 6 的 rewards 也随之推迟 → 铜牌与二幕入口也会被推迟**！
> **所以正确的拆法是**：把「发铜牌 + `know_east_depot` + 接二幕」从 `q_main_jianghu` 的 **`rewards`** 搬到
> **C9 的第一幕夜戏场景**（`road_huashan_1` 的 action）里发出（**这正是 C9 的核心价值**），
> 然后 `q_main_jianghu` 就**只剩"变强的长线校验"**，stage 4/5 悬在末尾不再伤及三~五幕。
> → **C3 与 C9 是同一个改动的两面**，工程请**一并做**。

**力量曲线变化（设计层面）**：

| 时段 | 改前 | 改后 |
|---|---|---|
| 一幕 | 拜师 → 学粗浅功夫 → **夜戏（救人/铜牌）** | 同（**夜戏成为真正的幕末**） |
| 二幕 | 门派之疑 → **已习得绝顶内功** | 门派之疑（**不再要求绝顶内功**） |
| 三幕 | 玩家已是顶级 → 假秘籍无诱惑 | **玩家仍是"有本事但没到顶"** → 假秘籍有诱惑 → **抉择② 才有重量** |
| 四幕 | 东方不败无压迫 | 东方不败是**真的打不过也得打**（靠拉回路径与解药减负，而不是靠数值碾压） |
| 四幕末 | — | **在此结算"击败一位名宿" + "习得绝顶内功"** —— 打完东方不败、拿到残卷的人，理应配得上绝学 |
| 五幕 | — | 黄药师那三句话**句句落在玩家真经历过的事上** |

> **一句话**：门槛后移不是"放水"，是把**"变强"从第一幕的入场券，改成走完四幕之后才配拿的奖赏**。
> 数值具体值（hp/绝学获取曲线）请与 `design/05-balance-spec.md` 一起定，本文只给结构与位置。

### 2.9.2 【C9 详述】第一幕「夜戏」补丁接口（**不新增房间**）

> 三幕的动机链全压在这一场：玩家必须**亲手救过一个人**、**亲手接过那块铜牌**，
> 第四幕末"东厂提督亲至"、第五幕末"三家之言"才有情感落点。

| 项 | 内容 |
|---|---|
| **舞台** | **`road_huashan_1`**（华山道·山脚，region `huashan`，现有房间；出口 `w→jiangnan_east_road` / `n→huashan_shanxia` / `e→road_shaolin_1`，**严格反向边已核 ✅**） |
| **为什么是这里** | 蓝图 1-4「初遇令狐冲」在 `huashan_houshan`，1-5「夜戏」写明"**你在山道**撞见官差押着一车犯人与行李"——`road_huashan_1` 正是上华山前的那段山脚道，**与 1-4 同一片区域、两条腿走路** |
| **入口 action** | `road_huashan_1`：「**夜宿山道**」（关键词 `夜宿`/`山道`/`扎营`） |
| **cond** | `{ and: [ {hasSect:true}, {notFlag:'jiuye_done'} ] }` —— **拜过师**才碰得到（对应 1-2/1-3）；不要求武学等级，避免卡住玩家 |
| **演出（effects 规格）** | ① `narrate` 天色/山道具体物（可复用 `road_huashan_1` 的 `desc` 意象）<br>② `narrate`「三更，山下来了一队人。前头两匹马，中间一辆车，车板上盖着油布。」<br>③ `say`（押车的官差）「让开。这是公文。」<br>④ `menu` **抉择**：「**动手**」> `flag jiuye_fought` · 「**退开**」> `flag jiuye_stood_aside`<br>⑤ 若「动手」→ `combat` vs `mob_soldier`（巡城兵丁，lv11，**现成 mob**）<br>⑥ 无论胜负 → `narrate`「车上滚下来一个人。他抓住你的袖子，塞过来一样硬东西。」<br>⑦ `+item depot_token_half` · `flag:'know_east_depot'` · `flag:'jiuye_done'`<br>⑧ `quest:['q_main_sect',0]`（**接第二幕**）· `narrate`（那人说的最后一句话） |
| **要改的数据** | ① `game/data/50_map.json`：给 `road_huashan_1` 加 1 个 `action`（**不动任何出口**，零反向边风险）<br>② `game/data/60_quests.json`：从 `q_main_jianghu.rewards` 里**搬走** `flag know_east_depot`、`+item depot_token_half`、`quest ['q_main_sect',0]` 三条 → 移入上面的 action effects（见 C3 的"两面"说明）<br>③ 二幕 `q_main_sect` 的 stage0 cond 已是 `flag know_east_depot`，**不用改**（只是触发点从"主线完成"变成"夜戏结束"） |
| **「退开」分支的代价** | 不阻止也不帮忙 → **仍然拿到铜牌**（那人还是塞给了你）→ **但 `<flag>jiuye_stood_aside` 会被第四/五幕读取**：第四幕东方不败会多一句评语，第五幕黄药师的**第一句话**不同 → **"你当初没伸手"这件事被世界记住了**（`08` 总纲 §3 铁律②「世界记得你」） |
| **与楔子的口径** | 楔子（`17-intro-rewrite.md`）只到"江南大路·茶摊·凡人开局"，**不涉及铜牌**；本场是**玩家第一次见到铜牌**，与楔子无冲突、与蓝图 1-5/1-6 严格一致 |

> ⚠️ **两处口径勘误（回填 `design/24`，2026-10-11）**：
> **①** 上表原写"第五幕黄药师的**第二句话**不同"——**已改**。细纲 §5.4 与 `design/24` 文案**都落在第一句**（5-4 换掉的是"你打过的第一个人，不是最坏的。"那句）。**以"第一句"为准**。
> **② flag 拼写以 `jiuye_*` 为准**（`jiu`，非 `jiaye`）：`jiuye_done` / `jiuye_fought` / `jiuye_stood_aside` —— 须与 `design/24` 场 1-5、4-2、5-4 **三处一致**；工程若误写 `jiaye_*`，4-2/5-4 分支永不触发。

---

# 3. 第三幕《伪秘籍》· 可落地细纲

> 任务：**`q_main_snow`【主线】伪秘籍**（新增）· 类型 `主线` · `level: 40` · giver **`shaolin_fangzheng`**  
> ⚠️ 落地铁律（二幕踩过）：**`giver` 指向的 NPC 必须把自己的 `def.quests` 挂上 `q_main_snow`**，否则 `交任务` 永远交不掉。  
> 入场条件：`act2_done`（= `sect_ashamed` + `know_xuemao`，即二幕末段 cond）

## 3.1 本幕设计骨架

- **核心问题**：东厂收集武功秘典——收集来做什么？
- **本幕要建立的**：**秘典是真的**（所以各派私藏），但**被人做成了诱饵**（练坏的人 = 官府的"实证"）。
- **节奏定调**：全剧最快、信息量最大。**7 场，平均每场 1~1.5 小时**；两次 Boss 战（血刀老祖 / 丁春秋）之间只隔一场，避免拖沓。
- **两条腿走路**：**北疆线**（真东西：血刀门私藏的抄本半卷）∥ **西域线**（假东西：丁春秋的速成秘籍）。两线在 3-7 汇合。
- **幕末落点**：`know_zhenyi` + 截获的往黑木崖的信 → 第四幕。

## 3.2 场次总表

| 场       | 场名                  | 舞台（room id）                                                              | 参与 NPC（真实 id）                                     | 触发 cond                                   | 玩家目标               | 落点 flag                                                     |
| ------- | ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------- | ------------------ | ----------------------------------------------------------- |
| **3-0** | **四处人情**（可选；**三处在江南，一处在西夏官道**）      | `jn_market_main` / `jn_brothel_room` / `jn_fruit_stall` / `road_xixia_1` | `npcv_180` / `npcv_252` / `npcv_090` / `npcv_248` | `snow_lead`                               | 收 3~4 条"软路径"       | `yue_zhi_road` / `chen_chaoben` / `ruan_cure` / `yu_ledger` |
| **3-1** | 少林·缺了一卷             | `shaolin_daxiong` → `shaolin_cangjing`                                   | `shaolin_fangzheng`                               | `know_xuemao` & !`snow_lead`              | 弄清"谁在用朝廷名义借书"      | `snow_lead`                                                 |
| **3-2** | 雪谷·山口               | `road_beijiang_1` → `beijiang_shankou`                                   | `mob_assassin`（埋伏）                                | `snow_lead`                               | 破第一道哨卡             | `pass_shankou`                                              |
| **3-3** | 血刀门·前庭（买路钱）         | `beijiang_xuedao`                                                        | `blood_saber` + `npcv_067/141/212/288`            | `pass_shankou` & !`blood_deal`            | **抉择①**：铜牌交不交      | `blood_deal` / `blood_saber_hostile`                        |
| **3-4** | 血刀寨·后寨（半卷）          | `beijiang_houzhai`                                                       | —                                                 | `blood_deal`                              | 拿到私藏的抄本半卷          | `xuedao_copy`                                               |
| **3-5** | 刀血（Boss）            | `beijiang_xuedao` → `hm_blood_saber`                                     | `blood_saber`（**3 阶段**）                           | `xuedao_copy` **或** `blood_saber_hostile` | 赢下血刀老祖             | `blood_saber_down` / `blood_saber_ally`                     |
| **3-6** | 疏勒镇 → 星宿海           | `xiyu_shule` → `xiyu_oasis` → `xiyu_xingxiu`                             | `xingxiu_laoxian` + `npcv_044/068/145/213`        | `pass_shankou`                            | **抉择②**：练/不练/揭破假秘籍 | `zhenyi_bait` / `poisoned_xingxiu`                          |
| **3-7** | 诡计（Boss）+ 盐场取证 + 截信 | `xiyu_xingxiu` → `xixia_yanchang` → `road_xixia_1`                       | `xingxiu_laoxian`（**3 阶段**）+ `npcv_248`           | `zhenyi_bait`                             | 揭破诱饵 + 截下往黑木崖的信    | `xingxiu_down` · **`know_zhenyi`** · `act3_done`            |

**场次设计说明**：

- **3-0 是"可选准备场"而不是必过关卡**——4 条软路径全部"不拿也能通关"，只是**没有它们，后面更贵**。这是本幕"多解 + 代价"的底座。
- **3-5 的顺序是活的**：玩家若 3-3 选了"不交铜牌"，Boss 战**提前到 3-3 当场**发生（拿不到 3-4 的抄本，后面的信息少一层）。两条路都通，**代价不同**。
- **3-7 把"揭破诱饵"与"截信"合并在同一场**，因为它们是同一个因果（丁春秋的假秘籍 → 官差拿人当实证 → 替东厂干这份活的人要把货交上去 → 那封信）。

## 3.3 逐场细写

### 场 3-0 · 四处人情（可选 · 四条"软路径"）

> ⚠️ **空间上分两批**（依 `design/24` 文案复查修订，**以 §3.9-C1 为准**）：
> **江南三处**（`jn_market_main` 乐知 / `jn_brothel_room` 陈语冰 / `jn_fruit_stall` 阮听）＝真·行前；
> **西夏一处**（`road_xixia_1` 俞初）＝**去西域的路上**（3-6 之前随时可去，不占行程）。

> 设计意图：让玩家在**出发前**先攒下"人情筹码"。四条全部是**画像里已经写好的钩子**（`portraits-new.json` 的 `hooks` 与 `arc`），  
> **主线只负责"用上它们"**，不新编人物。
>
> ⚠️ **用词约定（照画像的口径，别弄反）**：  
> **「拉回」= 执行画像 `arc.warm` 里的正向动作**（`trust/favor` 上升，人物往"没烂透"的那边走）；  
> **「堕落」= 执行画像 `arc.break` 里的动作**（人物被彻底推向反面，线索/人情断掉）。  
> **`arc.break` 的反面不是"拉回"，只是"没动手"**——真正的拉回必须**主动做点什么**。这条区分是本节四条路径的设计依据。

| 入口（room action）         | NPC               | 画像钩子                                                         | **拉回（做 `arc.warm` 的正向动作）**                         | 给的软路径                                    |
| ----------------------- | ----------------- | ------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------- |
| `jn_market_main`：「问北线」  | `npcv_180` 乐知（镖师） | `hk_npcv_180_beibian`《北边那趟镖》· `hk_npcv_180_qi`《车上那面旧旗》       | **在她面前不提华山**（warm +10）· 或替她把**岳不群那句挡回去**（warm +30） | `yue_zhi_road`：**北线小路** → 3-2 免一战        |
| `jn_brothel_room`：「问抄纸」 | `npcv_252` 陈语冰    | `hk_npcv_252_minge`《那个名额》· `hk_npcv_252_zi`《枕下那个字》           | **不在她面前提梅拾**（warm +10）· 或听她唱完一段曲（+15）              | `chen_chaoben`：**抄本流向** → 第六幕"半交"结局必需物之一 |
| `jn_fruit_stall`：「问解药」  | `npcv_090` 阮听（游侠） | `hk_npcv_090_jieyao`《丁春秋的解药》· `hk_npcv_090_meimei`《妹妹那碗药》    | **替他跑一趟星宿海**（warm +25）· 或不问他的箱子里是什么（+15）           | `ruan_cure`：**星宿海毒雾的解药** → 3-7 Boss 战减负  |
| `road_xixia_1`：「问盐册」    | `npcv_248` 俞初（官吏） | `hk_npcv_248_jiushui`《三年前那一笔》· `hk_npcv_248_changfu`《关外那个孩子》 | **不在她面前替常拂（`npcv_049`）说话**（warm +10）· 或送她好香（+10）   | `yu_ledger`：**假账册** → 3-7 取证更快           |

**每条的"堕落"分支（做 `arc.break`：拿现钱 / 得恶名 / 断线）**：

- **乐知** → 把当年那趟丢镖的事抖出去（`arc.break`）：`+money`、`npcv_180` store 崩、`yue_zhi_road` 永不可得（3-2 必打一场）。
- **陈语冰** → 把她抄纸的事告诉梅拾（`arc.break`）：`-karma 10`、`npcv_252` 被楼里处置、`chen_chaoben` 断（**"半交"结局将永远无法达成**）。
- **阮听** → 把他下毒的事说给毛清（`npcv_072`）（`arc.break`）：`+money 200`、`-karma 10`、`ruan_cure` 断（3-7 硬打）。
- **俞初** → **替常拂翻案**（`arc.break`）：`+karma 10`、`npcv_248` store 崩、`yu_ledger` 断；  
  但**改由 `npcv_049` 常拂本人给一条"关外线"**&#x53D6;证（`flag:'changfu_lead'`）——**慢一格、且官面转冷**（第五幕"应召进京"线更难走）。
  > 这一条的妙处：**"做好事"会毁掉一个已经走歪的人**。两条路都拿得到证据，代价不同——这正是本剧要的灰色。

**实现规格（四条同一个模子，`menu` 二选一）**：

```
入口 action：「问北线」（cond: flag snow_lead & notFlag yue_zhi_road & notFlag npv180_broken）
  effects: [ narrate(情境), say(NPC 的为难), 
             menu "（你说什么？）|（先问她的镖）>flag yue_zhi_road;flag npv180_warm
                                         ;;（提起当年那趟丢镖）>flag npv180_broken;+money;+karma -10" ]
```

- **「拉回」分支**：置 `*_warm` flag（并建议同时 `+favor`），给软路径 flag。
- **「堕落」分支**：置 `*_broken` flag，给现钱/恶名，**软路径永不可得**。
- **不选（直接走开）**：什么都不发生——**四场全跳过也通得过**，只是后面更贵。
- ⚠️ 每条**只能选一次**（`cond` 里带 `notFlag *_warm` 与 `notFlag *_broken`），避免刷。

**flag 命名约定**：`npv180_warm` / `npv180_broken` · `252_warm` / `252_broken` · `npv090_warm` / `npv090_broken` · `npv248_warm` / `npv248_broken`（+ `changfu_lead`）。

> ✅ 这四条 = **本幕 4 个"拉回路径"**（任务要求 ≥3，已超额）。

### 场 3-1 · 少林·缺了一卷（得 `snow_lead`）

- **舞台**：`shaolin_daxiong`（问方证）→ `shaolin_cangjing`（看经架取证）
- **入口 action**（新）：`shaolin_daxiong`：「**问缺卷**」，`cond: {flag:'know_xuemao', notFlag:'snow_lead'}`，`failMsg:"你还没弄清北边到底出了什么事。"`
- **effects 规格**（照二幕写法）：
  1. `narrate`：「方证大师没有让你坐。他把一卷册子推过来——封皮上的字被人裁去了一角。」
  2. `say`：「少林少了一卷。不是被偷的，是被人拿着朝廷的名义借走的。」（**容错写法**：不假设玩家与他交过手）
  3. `say`：「借书的人留了话，说看完就还。三年了。」
  4. `narrate`：「他顿了顿，忽然问：「你身上有铜腥味。去过北面？」
  5. `flag`：`snow_lead`
- **子步骤 action**：`shaolin_cangjing`：「**看经架**」，`cond:{flag:'snow_lead'}` → `narrate`（空出来的那格比别的干净得多）+ `flag:'zhengju_shaolin'`
- **本场不设抉择**（铺垫场）。**落点**：`snow_lead`

### 场 3-2 · 雪谷·山口（破第一道哨卡）


- **舞台**：`road_beijiang_1`（塞外风沙）→ `beijiang_shankou`（雪谷·山口，单出口）
- **入口 action**：`road_beijiang_1`：「**看车辙**」，`cond:{flag:'snow_lead'}` → `narrate`「车辙很深，压的是重东西，往西北去了。新雪还没盖住。」+ `flag:'road_found'`
- **入口 action**：`beijiang_shankou`：「**摸哨**」，`cond:{flag:'road_found', notFlag:'pass_shankou'}`
  - **有 `yue_zhi_road`**（乐知拉的线）：`narrate`「你贴着石壁走，脚下的雪被人扫过一遍——有人替你把路扫平了。」→ `flag:'pass_shankou'` + `flag:'shankou_quiet'`（**免战斗**）
  - **无 `yue_zhi_road`**：`narrate`「三个人从雪里站起来。」→ `combat` vs `mob_assassin`（1 名，lv33）→ 打赢置 `pass_shankou`；**打输**不从门口重来，改走"被押进前庭"（见下）
- **可失败的后果**：若 `mob_assassin` 打赢了玩家 → `narrate`「你是被拖进去的。」→ **跳过 3-3 的"买路钱"对话，直接从 `blood_saber_hostile` 开始**（等于替玩家选了 C 路线的最差分支，且他"手里东西被搜走"：`-item depot_token_half`）。**这条"输也有下文"的路，就是"不能只有打赢继续"的落地。**
- **落点**：`pass_shankou`

### 场 3-3 · 血刀门·前庭 · 抉择①「买路钱」

- **舞台**：`beijiang_xuedao`（血刀门·前庭，`respawn` 已有；场上还有 `npcv_067/141/212/288` 四名门人当背景）
- **为何必须用房间 action**：`blood_saber` 是 `hostile:true`，引擎**不允许对他 `talk`**（`commands.js:950/1644`）→ 所有对白走 action。
- **入口 action**：`beijiang_xuedao`：「**见刀主**」，`cond:{flag:'pass_shankou', notFlag:'blood_deal'}`
- **演出**：
  1. `narrate`：「堡门大开。门内横七竖八插着兵器，像一片长歪的林子。」（沿用该房间既有 `desc` 的意象）
  2. `say`（血刀老祖）：「北边这条道，从我这儿过，得留下买路钱。」
  3. `narrate`：「他伸出手。那只手在你看不见的地方，已经握了三十年刀。」
  4. `menu`：
     - **「把半块铜牌给他」>** `-item depot_token_half; flag blood_deal; flag depot_token_given`  
       → 后续 `narrate`：「他把铜牌翻过来看了看，脸上的肉抽了一下。」+ `flag:'xuedao_knows_token'`（**他认得**，是 3-4 "抄本半卷"的钥匙）  
       **长线代价**：铜牌是第五幕自证身份的关键物——**交了它，第五幕"应召进京"线要用另一条路证明你是谁**（见 §5.1）。
     - **「拿抄本半卷来换」（需 `flag:'xuedao_copy'`）>** `flag blood_deal; flag blood_deal_trade`  
       → **不丢铜牌**（最优解，但前提是玩家先在 3-4 潜入拿到抄本——见下"顺序说明"）
     - **「不交。拔剑。」>** `flag:'blood_saber_hostile'`  
       → 立刻 `combat` vs `blood_saber`（**Boss 提前打**，且拿不到 3-4 的抄本 → 3-6 只能靠"看秘籍"一条路，信息少一层）
- **⚠️ 顺序说明（重要）**：为让"以抄本换"这条路成立，**3-4 必须允许"先潜后谈"**：
  - 在 3-3 之前，若玩家**已从 `beijiang_houzhai` 拿到 `xuedao_copy`**（后寨入口 action「**摸后寨**」，`cond:{flag:'pass_shankou', notFlag:'xuedao_copy'}`，无战斗但有 `-hp` 风险），则 3-3 的"以抄本换"选项才出现。
  - 玩家若先谈后拿（走 A 路线），就**错过**"以抄本换"，但换来的是安全。
  - **两条路都通**：A（交铜牌）→ 稳妥、丢关键道具；C（硬来）→ 提前 Boss、少信息；B（以抄本换）→ 最省，但要求玩家先冒险摸寨。
- **落点**：`blood_deal` / `blood_saber_hostile` /（B 路线）`blood_deal_trade`

### 场 3-4 · 血刀寨·后寨（得 `xuedao_copy`）

- **舞台**：`beijiang_houzhai`（血刀寨·后寨，单出口 `w` → 前庭）
- **入口 action**：`beijiang_houzhai`：「**摸后寨**」，`cond:{flag:'blood_deal' 或 'pass_shankou', notFlag:'xuedao_copy'}`
- **演出**：`narrate`（一间上了三年锁的屋子，锁口新得反常）+ `narrate`「箱子里是半卷抄本。纸是新的，字是别人的——抄的人手很稳。」+ `+item xuedao_copy_half` + `flag:'xuedao_copy'`
- **信息**：这&#x662F;**"秘典确实存在、各派私藏"**&#x7684;实证（蓝图 3-3）。
- **落点**：`xuedao_copy`

### 场 3-5 · 刀血（Boss·血刀老祖）

- **舞台**：`beijiang_xuedao` →（打赢后）`hm_blood_saber`（血刀老祖的家）
- **触发**：`xuedao_copy`（走 A/B 路线后他反悔/索要更多）**或** `blood_saber_hostile`
- **登场方式**：`narrate`「他把刀从椅子上提起来的时候，椅子腿在土里陷了一寸。」
- **Boss 数据（§3.4 有完整 JSON）**：三阶段 刀血 → 化血（`lifesteal`）→ 血遁（`dodge/speed` + `summon`）
- **胜负分支**：
  - **赢** → `flag:'blood_saber_down'`
    - 若此前走 A/B（谈过、有 `xuedao_knows_token`）→ **追加拉回**：`narrate`「他咳了半天，笑了一声：「那半卷…你拿去吧。这东西看过的人，没一个有好下场。」」→ `flag:'blood_saber_ally'` + `+item xuedao_copy_half`（若还没拿到）
    - 若走 C（硬来）→ 只有 `blood_saber_down`，**无情报**（第四幕少一句关键提示）
  - **输** → 蓝图规则「不能打断，从门口重来」（引擎已保证阶段复位）→ 回到 `beijiang_xuedao`，**可选绕行**：`narrate`「他没追出来。他不需要追。」  
    → **不惩罚**，但**本场必过**（否则第四幕开不了）→ 建议 `failMsg` 提示"你还可以再攒一攒本事/拿点药"。
- **落点**：`blood_saber_down`（± `blood_saber_ally`）

### 场 3-6 · 疏勒镇 → 星宿海 · 抉择②「速成的诱惑」

- **舞台**：`xiyu_shule`（西域·疏勒镇）→ `xiyu_oasis`（绿洲）→ `xiyu_xingxiu`（星宿海）
- **入口 action**：`xiyu_shule`：「**问商队**」，`cond:{flag:'pass_shankou'}` → `narrate`（商队的人一听"星宿海"就不说话了；有个小孩往你手里塞了张纸）+ `flag:'shule_to_xingxiu'`
- **入口 action**：`xiyu_xingxiu`：「**见老仙**」，`cond:{flag:'shule_to_xingxiu'}` → **抉择②**
- **演出**：`say`（丁春秋）「你要的东西，我这儿有。别人要练三十年，我这门功夫，七天。」
- **`menu` 三选项**：
  1. **「练」>** `+attr 力量 2` + `+skill cuixin_zhang` + `flag:'poisoned_xingxiu'`  
     → `narrate`「你确实觉得快了。快得心口发慌。」+ `-hp` 上限（建议用 `+trait:poisoned_body` 的反面，或 `-attr` 定力 1，具体数值待 `05-balance-spec`）  
     **代价**：3-7 Boss 战时你会被他"化功"（`lifesteal`）打得更疼（剧情上），且第五幕黄药师的第二句话会点名这件事。
  2. **「不练」>** `flag:'refuse_fake'` → 无收益，但丁春秋会**轻蔑**（`say`「你倒是个聪明的傻子。」）
  3. **「这书是假的」>**（需 `flag:'xuedao_copy'` 或 `flag:'ruan_cure'`）→ `flag:'zhenyi_bait'` + `narrate`（你把两卷一对：同一个人抄的，字迹一样，可功力路数正反相冲）  
     → **直接把丁春秋拉进战斗**（3-7 提前开打，但**拿到核心证据**）
- **落点**：`zhenyi_bait` / `poisoned_xingxiu` / `refuse_fake`

### 场 3-7 · 诡计（Boss·丁春秋）+ 盐场取证 + 幕末截信

- **舞台**：`xiyu_xingxiu` →（走到）`xixia_yanchang`（西夏·盐场）→ `xixia_ice`（冰窖，可选）→ `road_xixia_1`（截信）
- **Boss 登场**：`narrate`「他拍手的时候，星宿海的水面浮起来一排人——那是他教出来的，也长得像他。」
- **Boss 数据**：三阶段 毒雾 → 化功（`lifesteal`）→ 诡计（`summon`）
- **打赢**：`flag:'xingxiu_down'` + `+item fake_manual`（假秘籍，作证物）
  - 有 `ruan_cure`（阮听的解药）→ `narrate`「你把解药含在舌下。那股腥味没能进到喉咙里。」（Boss 战减负，建议实现为战前 `+buff`）
- **取证场**：`xixia_yanchang`：「**问煮盐人**」，`cond:{or:[{flag:'xingxiu_down'},{flag:'zhenyi_bait'}]}`
  > 🔧 **C-5 修订（主理人批准）**：原为 `cond:{flag:'xingxiu_down'}`，**会把取证锁死在"必须打赢"之后**，与"战斗不是唯一出路"冲突。**已放宽为 `or`** —— 走"揭破诱饵"（`zhenyi_bait`）的非战斗线同样能取证。  
  → `say`「上个月拉了十几个人走。都是胳膊上有劲、可眼神不对的。」+ `narrate`（盐册上多出来的那一栏：不是盐，是人）  
  → **`yu_ledger` 有否决定取证速度**：有 → 一次 action 拿到；无 → 需 `npcv_248` 对话 + 两次 action
- **幕末截信**：`road_xixia_1`：「**截信**」，`cond:{flag:'xingxiu_down', notFlag:'know_zhenyi'}`
  1. `narrate`「一骑快马从北边来，在盐场外换了马，没停。」
  2. `narrate`（截下的信只有两行）：「**残卷在绣阁，请东方教主亲自验收。**」+「**京里的那位，等不了太久。**」
  3. `say`（押信的人）「你截了这个，就再没有回头路了。你想清楚没有。」
  4. `flag:'know_zhenyi'` + `flag:'act3_done'` + `questdone:'q_main_snow'` + `quest:['q_main_moye',0]`（接第四幕）
- **落点**：**`know_zhenyi`** · `act3_done` · 接第四幕

## 3.4 本幕 Boss 数据（可直接粘贴的 `bossPhases`）

> 已按引擎实测能力写成：`at` 递减；`mult` 走 `statOf` 的键；`lifesteal/reflect` 为**绝对值**；`summon` 用**真实 mob id**。

**① `blood_saber`（血刀老祖，hp 4600）** —— 新增 `bossPhases`

```json
[
  { "at": 1, "name": "刀血", "skill": "xuedao",
    "line": "（他把刀从椅子上提起来。刀上那层锈色，像刚凝的血。）「过这条道，先让我看看你值几两。」",
    "desc": "他的刀不快，可每一刀都往同一个地方落。",
    "mult": { "atk": 1.1, "speed": 1.05 } },
  { "at": 0.6, "name": "化血", "skill": "xuedao",
    "line": "（他忽然吸了口气。你腕上那道血线，竟逆着往上爬。）",
    "desc": "刀口吃过的人越多，他站得越稳——那些血本来是你的。",
    "mult": { "atk": 1.05, "def": 1.15, "lifesteal": 0.3 } },
  { "at": 0.3, "name": "血遁",
    "line": "（他退到兵器堆后，一柄一柄地拔刀。）「血刀门没输过。只是换个人接。」",
    "desc": "他不走。他换人。",
    "mult": { "atk": 0.9, "dodge": 1.5, "speed": 1.3 },
    "summon": { "npc": "mob_bandit_chief", "count": 2 } }
]
```

> ⚠️ 蓝图原义「血遁＝逃跑重召」**引擎不支持**。此处改为"他退到人后面 + 召两名刀客"，**语义等价、零引擎改动**。  
> 若要真"遁走再召"，需 `combat.js` 新增逃逸机制——**建议不做**（不在本批范围）。

**② `xingxiu_laoxian`（丁春秋，hp 4000）** —— 新增 `bossPhases`

```json
[
  { "at": 1, "name": "毒雾", "skill": "tangmen_du",
    "line": "（他笑着后退三步，袍袖一抖。）「先尝尝。谢我就不必了。」",
    "desc": "水面起了雾。雾里什么都好看，就是喘不上气。",
    "mult": { "atk": 1.05, "speed": 1.05 } },
  { "at": 0.6, "name": "化功", "skill": "cuixin_zhang",
    "line": "「你这一身内力，放着也是放着。」",
    "desc": "你每出一掌，他就多一分力气——那力气原本是你的。",
    "mult": { "atk": 1.1, "lifesteal": 0.35 } },
  { "at": 0.3, "name": "诡计",
    "line": "（他拍手。星宿海的水里站起来一排人。）「我教的，都像我。」",
    "mult": { "atk": 0.95, "def": 1.3 },
    "summon": { "npc": "mob_mo_disciple", "count": 3 } }
]
```

> `mob_mo_disciple`（魔教教众，lv21）是**现成素材**；若主人要求"星宿弟子"专有形象，再新增 `mob_xingxiu_dizi`（**非必需**）。

## 3.5 本幕抉择与代价（一览）

| # | 场   | 抉择                                        | 代价（**长线**）                                                                               |
| - | --- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| ① | 3-3 | 铜牌 交 / 换 / 不给                             | 交 → **丢第五幕自证物**；不给 → Boss 提前 + 少一层情报；换 → 需先冒险摸后寨                                         |
| ② | 3-6 | 假秘籍 练 / 不练 / 揭破                           | 练 → 变强但**身体留账**，第五幕被黄药师点名；揭破 → 提前 Boss，但拿到核心证据                                           |
| ③ | 3-0 | 四条软路径：做 `arc.warm`（拉人）/ 做 `arc.break`（卖人） | 拉人 → 后面省事；卖人 → 拿现钱 + 恶名，**且"半交"结局可能永久锁死**；**俞初那条反过来**：替常拂翻案（`break`）会毁掉她，`+karma` 但取证慢一格 |

## 3.6 第三幕 → 第四幕衔接（写给下一幕的第一句）

- 信上写着「残卷在**绣阁**」（C8 已统一命名），落款不具名，只说"京里的那位等不了太久"。
- 玩家此刻应当知道的：`know_zhenyi`（秘典存在、且被做成了诱饵）、`know_depot_master` 尚**未**得到（第四幕末段才给）。
- 第四幕第一场应当**直接从上崖路开始**：`jiangnan_east_road` → `mojiao_shanmen`（山门已是 encounter 区）。
- **信息差**：玩家以为要去抢秘典，第四幕告诉他"抢秘典的人也在被逼"。

## 3.7 需新增 / 修改的数据清单（工程照做）

**① 任务**：新增 `q_main_snow`

```
id: q_main_snow · name: 【主线】伪秘籍 · type: 主线 · level: 40 · giver: shaolin_fangzheng
stages: 7 段，cond 依次为
  [0] flag snow_lead            → 少林缺卷
  [1] flag pass_shankou         → 破雪谷山口
  [2] flag blood_deal 或 blood_saber_hostile → 前庭·买路钱
  [3] flag xuedao_copy          → 后寨·半卷
  [4] flag blood_saber_down     → 刀血
  [5] flag zhenyi_bait 或 poisoned_xingxiu 或 refuse_fake → 星宿海·抉择②
  [6] flag know_zhenyi（next:99）→ 截信
rewards: +exp 12000 · +pot 6000 · +title「闻腥者」· flag act3_done · flag know_zhenyi
         · quest ['q_main_moye', 0] · narrate（第四幕引子）
```

**② 挂任务**：`shaolin_fangzheng.def.quests += 'q_main_snow'`（**否则交不掉**）

**③ flag 清单（新增）**：`snow_lead` · `zhengju_shaolin` · `road_found` · `pass_shankou` · `shankou_quiet` · `blood_deal` · `blood_deal_trade` · `depot_token_given` · `xuedao_knows_token` · `blood_saber_hostile` · `xuedao_copy` · `blood_saber_down` · `blood_saber_ally` · `shule_to_xingxiu` · `poisoned_xingxiu` · `refuse_fake` · `zhenyi_bait` · `xingxiu_down` · `know_zhenyi` · `act3_done` · `yue_zhi_road` · `chen_chaoben` · `ruan_cure` · `yu_ledger`  
**③-b 行前场成对 flag（§3.3 场 3-0）**：`npv180_warm`/`npv180_broken` · `252_warm`/`252_broken` · `npv090_warm`/`npv090_broken` · `npv248_warm`/`npv248_broken` · `changfu_lead`（俞初走堕落分支时的替代取证线）

**④ 房间 `actions`（新增 13 个）**：  
`shaolin_daxiong`「问缺卷」· `shaolin_cangjing`「看经架」· `road_beijiang_1`「看车辙」· `beijiang_shankou`「摸哨」·  
`beijiang_xuedao`「见刀主」· `beijiang_houzhai`「摸后寨」· `xiyu_shule`「问商队」· `xiyu_xingxiu`「见老仙」·  
`xixia_yanchang`「问煮盐人」· `road_xixia_1`「截信」· `jn_market_main`「问北线」· `jn_brothel_room`「问抄纸」·  
`jn_fruit_stall`「问解药」（**13 个，含 3 个行前**）

**⑤ Boss**：`blood_saber.bossPhases` / `xingxiu_laoxian.bossPhases`（§3.4 的 JSON）

**⑥ 物品（新增 5 件）**：`xuedao_copy_half`（血刀门·半卷抄本）· `fake_manual`（速成秘籍·伪）·  
`yu_ledger_item`（盐场假账册）· `star_cure_item`（星宿海解药）· 复用 `depot_token_half`（消耗）

**⑦ 无新增 NPC**（本幕只用现成真人；`mob_assassin`/`mob_bandit_chief`/`mob_mo_disciple` 均已在库）

## 3.8 支线接口（只标不写，留给 #115）

| 地点 | 可挂支线的 NPC                                   | 接口方式                                                      |
| -- | ------------------------------------------- | --------------------------------------------------------- |
| 北疆 | `npcv_067` `npcv_141` `npcv_212` `npcv_288` | 血刀门四门人：主线后（`blood_saber_down`）各可给一条"血刀门散了以后"的支线           |
| 西域 | `npcv_044` `npcv_068` `npcv_145` `npcv_213` | 疏勒镇商队/绿洲：假秘籍的**下游受害者**支线                                  |
| 西夏 | `npcv_049`(常拂) · `npcv_071` · `npcv_222`    | 常拂的旧案 → 与 `npcv_248` 的画像钩子 `hk_npcv_248_changfu` 同一根线     |
| 反向 | `npcv_090` `npcv_180` `npcv_252`            | 主线已"用掉"其 `hooks` → 支线应写**主线之后**的后续（如 `npcv_090` 妹妹那碗药的结局） |

---

# 4. 第四幕《黑木之崖》· 可落地细纲

> 任务：**`q_main_moye`【主线】黑木之崖**（新增）· 类型 `主线` · `level: 50` · giver **`mojiao_dongfang`**（东方不败）
> ⚠️ **两个坑**：① `giver` 必须挂 `def.quests`（`mojiao_dongfang.def.quests += 'q_main_moye'`），否则交不掉；
> ② 他是 `hostile:true`，**引擎不允许对他 `talk`**（`commands.js:950/1644`）→ **4-2 的对白必须走房间 action**。
> 入场条件：`act3_done`（三幕 rewards 落）。本幕依赖：**C4 新增 `ren_woxing`**、**C5 新增 `wulin_zhenyi_canjuan`**（均已批准）。

## 4.1 本幕设计骨架

- **核心问题**：谁在收这些秘典？
- **推翻上一幕**：三幕说"秘籍被做了手脚"；四幕说**做手脚的人不在江湖里**。
- **本幕要建立的**：江湖里最大的敌人（东方不败）**也只是棋子**；玩家身份从"江湖人"变成"被朝廷盯着的人"。
- **全剧最重的一幕**：6 场，两道 Boss 卡（东方不败 3 阶段 / 任我行 3 阶段），中间夹两次抉择（信不信他 / 接不接他的帖子）。
- **幕末落点**：`know_depot_master` + `act4_done` → 第五幕。

## 4.2 场次总表（6 场）

| 场 | 场名 | 舞台（room id） | 参与 NPC（真实 id） | 触发 cond | 玩家目标 | 落点 flag |
|---|---|---|---|---|---|---|
| **4-1** | 上崖 · 三道哨卡 | `jiangnan_east_road` → `mojiao_shanmen` → `mojiao_hall` → `mojiao_shuangxiu` | `npcv_164`(皮朝颜) + `npcv_053/119/185/251`（大殿四侍者） | `act3_done` | 过三道哨卡（可走暗道） | `moye_sentinel` |
| **4-2** | 绣阁 · 他先说 | `mojiao_shuangxiu` | `mojiao_dongfang` | `moye_sentinel` & !`dongfang_talks` | 听东方自称"被逼"；**抉择⑤** | `dongfang_talks` / `dongfang_pact` |
| **4-3** | 绣阁 · 绣花针（Boss） | `mojiao_shuangxiu` | `mojiao_dongfang`（**bossPhases 已完整**） | `dongfang_talks` | 赢下东方不败 | `dongfang_down` |
| **4-4** | 大殿 · 第二只手 | `mojiao_hall` | **`ren_woxing`**（新增 · C4） | `dongfang_down` | 任我行现身；**抉择④** | `ren_appears` / `ren_pact` |
| **4-5** | 绣阁 · 残卷 | `mojiao_shuangxiu` | — | `ren_appears` | 拿到《武林真意》**残卷** | `has_canjuan` |
| **4-6** | 绣阁 · 朝堂的回音 | `mojiao_shuangxiu` | `depot_master` + `depot_shadow`（**`spawn` 到绣阁**） | `has_canjuan` | 东厂提督亲至 | **`know_depot_master`** · `act4_done` |

**舞台说明（不新增房间）**：
- `mojiao_shanmen` 已有 `encounter`（魔教教众）→ **第一道哨卡即明卡**。
- `mojiao_hall` 现驻四位"嫔妃"头衔的侍者（`npcv_053` 禹清 / `npcv_119` 蔡落 / `npcv_185` 元明月 / `npcv_251` 田绿）——**正合东方不败"绣阁如内廷"的设定**，本幕直接当"绣阁四侍者"用，**不改数据**。
- `mojiao_shuangxiu` 单出口（`s→mojiao_hall`），**"第三道哨卡"没有独立房间** → 用 action 演出（**不补房、不动地图、零反向边风险**）。
- 上崖路：`jiangnan_east_road` 的 `s → mojiao_shanmen`（**严格反向边已核 ✅**）。

## 4.3 逐场细写

### 场 4-1 · 上崖 · 三道哨卡

| 道 | 舞台 | action（新） | cond | 有软路径时 | 无软路径时 |
|---|---|---|---|---|---|
| ① | `mojiao_shanmen` | 「**闯山门**」 | `act3_done` & !`sentinel1` | 有 `moye_backroad`（皮朝颜拉的线）→ `narrate`「后山藤蔓下有一道只容一人的石缝。」→ `goto mojiao_hall` **跳过本道** | `combat` vs `mob_mo_disciple`（1 名，lv21） |
| ② | `mojiao_hall` | 「**过前殿**」 | `sentinel1` & !`sentinel2` | — | `narrate`（四位侍者立在殿侧，谁也不看你）→ `combat` vs `mob_mo_disciple`×2 |
| ③ | `mojiao_shuangxiu` | 「**上绣楼**」 | `sentinel2` & !`sentinel3` | 有 `buju`（鲁半夏给的布防）→ 追加 `narrate`（木梯第 47 级是虚的 / 东方左肩有旧伤） | `narrate`「九十九级木梯。走到一半，你听见上面有针穿布的声音。」 |

- **三道走完** → `flag:'moye_sentinel'`
- **可失败的后果**：任一道 `combat` 打输 → 蓝图规则"不能打断，从门口重来"（回 `mojiao_shanmen`），**不惩罚**；
  但 `sentinel1/2/3` **建议保留**，让"重来"只重复当前一道，而不是三道全打第二遍。

### 场 4-2 · 绣阁 · 他先说（**抉择⑤**）

- **入口 action**：`mojiao_shuangxiu`：「**见教主**」，`cond: {flag:'moye_sentinel', notFlag:'dongfang_talks'}`
- **演出（effects 规格）**：
  1. `narrate`「绣架上绷着一幅没绣完的东西。针还在上面，线是红的。」
  2. `say`（东方不败）「你不是第一个来的。前七个，走的都是同一条路——从山门打上来。」
  3. `say`「他们要的东西，我这儿没有。我这儿只有一张单子。」
  4. `say`「**收秘典的不是我。是朝里那位。**」
  5. **若 `jiuye_stood_aside`**（第一幕夜戏你退了开）→ 追加 `say`「你身上有过那条道上的味道。那晚你站在旁边，是不是。」（**记忆兑现 · C9 的价值**）
  6. `menu`：「听完他的话，你怎么做？」
     - **「替他把那张单子带出去」>** `flag:'dongfang_pact'` + `+buff`（「他的留手」→ 4-3 减负）
       **代价**：你**欠了他一次**；第五幕终局会多一条"他托你办的事"的线（见 §6 尾声）
     - **「不信。他要的东西，自己来拿」>** `flag:'dongfang_hostile'` → 4-3 **打满三阶段**（无减负）
  7. `flag:'dongfang_talks'`

### 场 4-3 · 绣阁 · 绣花针（Boss）

- **登场**：`narrate`「他把针放下的时候，你才看清——那根针一直在绣，绣的不是布。」
- **Boss**：`mojiao_dongfang`，**`bossPhases` 已完整**（现有数据，无需改）：
  `100% 绣花针`（`pixie_jianfa` · atk×1.15 speed×1.25）→ `60% 化生`（`heimu_zhang` · reflect 0.3）→ `30% 弃攻守势`（atk×0.8 def×1.6 dodge×1.5 speed×0.9）
- **减负（拉回路径的价值）**：有 `dongfang_pact` → 战前 `+buff`（他收三成力）；有 `buju` → 追加 `+buff`（你知道第 47 级木梯是虚的）
- **胜负**：
  - **赢** → `flag:'dongfang_down'` + `narrate`「他咳了几声，把那张单子推过来。」+（若有 `dongfang_pact`）`narrate`「「答应我的事，别忘了。」」
  - **输** → 从门口重来（**引擎已保证阶段复位**）。`failMsg: "打不过就先去把该拿的东西拿到——布防、解药、人情，都算数。"`
- ⚠️ 本场**必过**（否则四五幕开不了），但**允许"靠人情减负"而不是"靠数值碾压"**——这是 C3 后移门槛的核心目的。

### 场 4-4 · 大殿 · 第二只手（**抉择④**）

- **入口 action**：`mojiao_hall`：「**回大殿**」，`cond: {flag:'dongfang_down', notFlag:'ren_appears'}`
- **演出**：
  1. `narrate`「殿上那张交椅空了。空椅旁边站着一个人，背对着你，正在看墙上那幅画。」
  2. `say`（任我行）「残卷？残卷我找了三十年。」
  3. `say`「**我不是替朝廷找。我是替我自己找。**」
  4. `menu`：「他怎么用你，你怎么用他？」
     - **「接下他的帖子」>** `flag:'ren_pact'` → 4-5 拿残卷**更顺**（他替你把绣绷拆开）
       **代价**：**欠他一次**——第五幕若选「交卷」，他会当场翻脸（**多一场遭遇战**，见 §6）
     - **「不接」>** `flag:'ren_refused'` → 4-5 之后**追加一战** `combat` vs `ren_woxing`（**3 阶段，见 §4.4**）
  5. `flag:'ren_appears'`

### 场 4-5 · 绣阁 · 残卷（得 `wulin_zhenyi_canjuan`）

- **入口 action**：`mojiao_shuangxiu`：「**翻绣架**」，`cond: {flag:'ren_appears', notFlag:'has_canjuan'}`
- **演出**：
  1. `narrate`「绣绷底下是空的。东西缝在夹层里——一节一节的，像被人裁过。」
  2. `narrate`「拿出来才看清：**一半被人剪走了。** 剩下的这半，字还认得，理接不上。」（**"残卷"的字面落地**）
  3. `+item wulin_zhenyi_canjuan` + `flag:'has_canjuan'`
     - 若 `ren_pact` → 追加 `say`（任我行）「拆得干净吧。记住，你欠我一次。」
- **⚠️ 物品说明必须写"残缺"**（第五幕黄药师的三句话之一要指它）。

### 场 4-6 · 绣阁 · 朝堂的回音（幕末）

- **入口 action**：`mojiao_shuangxiu`：「**下崖**」，`cond: {flag:'has_canjuan', notFlag:'know_depot_master'}`
- **演出**：
  1. `spawn` `depot_master` 到 `mojiao_shuangxiu`；`spawn` `depot_shadow` 到 `mojiao_shuangxiu`
  2. `narrate`「山下的火把排成了两行。有人上山了，走得很慢，一点也不急。」
  3. `say`（冯保）「「奉天承运。」他说得很轻，「请你进京。」」
  4. `narrate`「他身后那道影子，比别人的长。」
  5. `flag:'know_depot_master'` + `flag:'act4_done'` + `questdone:'q_main_moye'` + `quest:['q_main_end',0]`
- **落点**：**`know_depot_master`** · `act4_done` · 接第五幕

## 4.4 本幕 Boss 数据

**① `mojiao_dongfang`（东方不败）** —— ✅ **现有数据已完整，不改**（100% 绣花针 → 60% 化生 → 30% 弃攻守势）

**② `ren_woxing`（任我行 · 新增）** —— 需求规格（写进 `game/data/40_npcs.json`）

```json
{
  "id": "ren_woxing", "name": "任我行", "title": "日月神教前教主",
  "tier": "A", "tag": "swordsman", "sect": "mojiao",
  "room": "mojiao_hall", "level": 55, "hp": 6200, "hostile": true,
  "skills": { "内功": "xixing_dafa", "拳": "heimu_zhang" },
  "bossPhases": [
    { "at": 1, "name": "吸星", "skill": "xixing_dafa",
      "line": "（他伸出手。你发现自己的手掌先凉了。）「内力这东西，存在别人身上，才是浪费。」",
      "desc": "他不打你。他在取你。",
      "mult": { "atk": 1.1, "speed": 1.05 } },
    { "at": 0.6, "name": "夺功", "skill": "xixing_dafa",
      "line": "「你这一身，正好补我这些年的亏空。」",
      "desc": "他每出一掌，你身上就少一样东西——先是力气，后来是话。",
      "mult": { "atk": 1.1, "def": 1.15, "lifesteal": 0.4 } },
    { "at": 0.3, "name": "反噬",
      "line": "（他的脸色白了一下——吸进去的太杂。）「……不够。」",
      "desc": "他吞得太急了。你看见他手背上的青筋在跳。",
      "mult": { "atk": 1.3, "def": 0.8, "dodge": 0.9 } }
  ],
  "quests": []
}
```

> **设计意图**：`反噬` 阶段**不换招、降防**——他"吞得太急"自己露了破绽。**这既是给玩家的翻盘点，也是他的性格。**
> 依赖 `xixing_dafa`（✅ 已存在）+ `heimu_zhang`（✅ 已存在）→ **零新增 skill**。
> 仍需补一份 A 层 `portrait`（字段规格见 §8，与 `depot_master` 同构）。

## 4.5 本幕拉回路径（2 条 · 均取 `arc.warm` 的正向动作）

- `npcv_164` 皮朝颜（`mojiao_shanmen` 赌徒）——**替她把那笔周转银子查清来路**（`arc.warm` +30；钩子 `hk_npcv_164_yinzi`《那笔周转银子》）+ **不在她面前提"枯井"**（+10）
  → `flag:'moye_backroad'`（**后山暗道** → 4-1 免第一道哨卡）。堕落 = 把死人账的事捅给教外的人（`arc.break`，钩子 `hk_npcv_164_sirenzhang`）。
- `npcv_186` 鲁半夏（`jn_brothel_hall`，魔教内线）——**在她面前不提日月神教**（`arc.warm` +10）/ 替她带一支好胭脂（+10）
  → `flag:'buju'`（**绣阁布防** → 4-1 第三道与 4-3 减负）。堕落 = 把她递消息的事告诉东方不败（`arc.break`，钩子 `hk_npcv_186_zuihua`）。
  > ⚠️ 她的 `room` 在 `jn_brothel_hall`（江南），**不在黑木崖** → 本场是**出发前的行前场**（与三幕 3-0 同模子：`menu` 二选一，拉回 / 堕落）。

## 4.6 本幕抉择与代价

| # | 场 | 抉择 | 代价（长线） |
|---|---|---|---|
| ⑤ | 4-2 | 接下东方的托付 / 不信 | 接下 → 4-3 减负，但**欠他一次**，第五幕终局多一条线；不信 → 打满三阶段 |
| ④ | 4-4 | 接任我行的帖子 / 不接 | 接下 → 4-5 更顺，但**欠他一次**：第五幕选「交卷」他会翻脸（多一场遭遇战）；不接 → 立刻多打一场 Boss |

## 4.7 第四幕 → 第五幕衔接

- `act4_done` 落下后，**全剧进入收束段**：C3 的"名宿 + 绝学"门槛**也在这一刻前后结算**（见 §2.9.1）。
- 第五幕第一场应当**直接给玩家一个"选进不进京"的岔口**（`palace_street`），并且**必须在此拿到 `palace_token`**（C7）。

## 4.8 本幕支线接口（留给 #115）

| 地点 | 可挂支线的 NPC | 接口 |
|---|---|---|
| 黑木崖 | `npcv_053` `npcv_119` `npcv_185` `npcv_251` | "绣阁四侍者"：东方不败败后各自的去向（可写"带走绣架的人"） |
| 黑木崖 | `npcv_164` `npcv_186` | 主线已用其 `hooks` → 支线写**之后**（死人账的来路 / 她递出去那句话的后果） |
| 大殿 | `ren_woxing` | 新增 NPC 的 `arc`/`hooks` 留待画像补全后挂支线 |

---

# 5. 第五幕《江湖路远》· 可落地细纲

> 任务：**`q_main_end`【主线】江湖路远**（新增）· 类型 `主线` · `level: 60` · giver **`nv_huang`**（黄药师）
> ⚠️ `giver` 必须挂 `def.quests`（`nv_huang.def.quests += 'q_main_end'`）。他 `hostile:false`，**可以正常对话**。
> 入场条件：`act4_done`。本幕依赖：**C7 腰牌来路**（已批准三条）、**C5 两件残卷/抄本物品**。

## 5.1 本幕设计骨架

- **核心问题**：进京，还是不进去？
- **推翻上一幕**：四幕说"敌人在朝堂"；五幕说**赢了也没有答案**。
- **本幕要建立的**：没有大团圆。玩家拿到的是"**看清了江湖**"，不是"统一了江湖"（总纲 §2 铁律）。
- **幕末落点**：`ending_jiaojuan` / `ending_jujiao` / `ending_banjiao`。

## 5.2 场次总表（6 场）

| 场 | 场名 | 舞台（room id） | 参与 NPC（真实 id） | 触发 cond | 玩家目标 | 落点 flag |
|---|---|---|---|---|---|---|
| **5-1** | 御街 · 公文与腰牌 | `palace_street` | — | `act4_done` | **抉择⑥**：应召 / 拒召；**拿腰牌** | `summoned` / `refused_summon` |
| **5-2** | 渡海 · 上岛 | `haitan_boat` → `taohuadao_dock` → `taohuadao_forest` | `npcv_229`(艄公) `npcv_046` `npcv_207` | `has_canjuan` | 找到黄药师的路 | `taohua_road` |
| **5-3** | 蛇阵 · 考题 | `taohuadao_she` → `taohuadao_zhu` | `npcv_139`(掌柜) `npcv_278`(流民) `npcv_140`(店伙) | `taohua_road` | **破阵**（现有 action「破阵」）——不是关卡，是考题 | `taohua_passed` |
| **5-4** | 清音洞 · 三家之言 | `taohuadao_qingyin` | `nv_huang` + `npcv_047`(流民) `npcv_210`(孩童) | `taohua_passed` | **三句话**（不给秘籍） | `three_words` |
| **5-5** | 御道 · 那道影子 | `palace_road` | `depot_shadow`（**2 阶段**） | `three_words` | 进门前先过影子 | `shadow_done` |
| **5-6** | 太和殿 · 终局 | `palace_gate` → `palace_plaza` → `palace_hall` | `depot_master`（**3 阶段**）+ `depot_shadow` + `guard_palace` | `three_words` & `palace_token` | **`menu` 三选项 = 三结局** | `ending_*` |

**舞台说明（不新增房间）**：
- `palace_road`（御道）**无需腰牌**即可从 `palace_gate` 的 `w` 进入 → **5-5 的影子遭遇放在门外**，玩家无论如何都碰得到（"想进京，先过影子"）。
- `palace_hall`（太和殿）是 `depot_master` 的常驻房 + 龙案所在 → **终局天然落在这里**。
- `palace_prison`（天牢）在 `palace_hall` 的 `nw`（**需腰牌**）→ 是"拒交"结局的一个分支点（见 §6 尾声）。
- 渡海链：`road_haibin_1 → haitan_dock → haitan_boat → taohuadao_dock`（**严格反向边已核 ✅**）。

## 5.3 腰牌三条来路（**C7 落地**）

| 线 | 舞台 / 条件 | 给牌方式 |
|---|---|---|
| **① 应召线（主路）** | `palace_street`，5-1 的 action「**拆公文**」，`cond: {flag:'act4_done'}` | 选「应召进京」→ `narrate`「公文袋里还夹着一块腰牌——他们的意思很清楚：**来，或者被带来。**」→ `+item palace_token` |
| **② 胡录事线** | `jn_yamen_office`，action「**补个名分**」，`cond: {flag:'clerk_met'}` | `say`（胡录事）「衙门的差役名册上，多一个名字不显眼。」→ `+item palace_token`（**不选应召也能拿**） |
| **③ 捕快线（拉回路径 · §5.6）** | ⚠️ **`palace_road`（御道 · 门外，无需腰牌）**，`npcv_082` 夏承志的拉回（**原文写的 `palace_prison` 作废 —— 那是循环依赖，见 §3.9-C11**） | 他给你 `+item palace_token` + `flag:'prison_intel'`（天牢门禁情报） |

> **设计意图**：三条来路对应三种玩法倾向——**顺从朝廷 / 走制度线 / 走人情线**。玩家至少有一条能走通，**不会卡死**。
> ⚠️ 若三条都没拿（既拒召、又没 `clerk_met`、又不找 `npcv_082`），5-6 将**物理无法进入** → 5-6 的 `failMsg` 必须明确提示"你还有两条路能拿到腰牌"（**不做"无路可走"的死局**）。

## 5.4 本幕 Boss 数据

**① `depot_master`（冯保）** —— ✅ **现有数据已完整，不改**（100% 绣春刀 → 60% 影卫·`summon depot_shadow` → 30% 圣旨）
**② `depot_shadow`（影子）** —— ✅ **现有数据 2 阶段**（随影 → 分影），本幕直接用在 5-5（若主人要"三阶段"，可再加一档，**非必需**）
**③ `nv_huang`（黄药师）** —— ⚠️ **本方案不安排与他的战斗**

- **理由**：他是**第五幕委托人**。让他当 Boss，就重演蓝图 §0 专门规避的"玩家得打自己的委托人"（当年正是为此才把一/二幕委托人从方证换成冲虚）。
- 因此 **C6 里 `nv_huang` 的 `bossPhases` 改列为"备用（可选彩蛋）"**：若主人想保留蓝图 §3 的"落英神剑掌"设定，可作为 5-4 之后的**可选切磋**。JSON 如下（**默认不做**）：

```json
[
  { "at": 1, "name": "落英神剑掌", "skill": "luoying_shenjian_zhang",
    "line": "（他没起身。袖子一拂，满洞的落花忽然都朝他那边去了。）「你连门都没进。」",
    "mult": { "atk": 1.1, "speed": 1.1 } },
  { "at": 0.6, "name": "旋风扫", "skill": "kuangfeng_daofa",
    "line": "「换个法子打，省得你死得太快。」",
    "desc": "他不出洞，只把洞口的碎石一脚扫地过来。",
    "mult": { "atk": 1.05, "def": 1.1 } },
  { "at": 0.3, "name": "移步",
    "line": "（他退了三步，站到你打不着的地方。）「到这儿。够了。」",
    "mult": { "atk": 0.9, "dodge": 1.6, "speed": 1.3 } }
]
```

> 若做此彩蛋，需新增 skill **`luoying_shenjian_zhang`（落英神剑掌）**（全库无 `luoying*`，已核）。
> **若不做彩蛋，则本 skill 也不用新增。**
> **主理人已定（2026-10-11）：默认否 —— 不启用此彩蛋。** 理由：`nv_huang` 是第五幕委托人，
> 与委托人动手会重演蓝图 §0 专门规避的"打自己的委托人"（当年正因如此才把一/二幕委托人从方证换成冲虚）。
> **本 JSON 仅作留档，需要时再启。**

## 5.5 逐场细写

### 场 5-1 · 御街 · 公文与腰牌（**抉择⑥**）

- **入口 action**：`palace_street`：「**拆公文**」，`cond: {flag:'act4_done'}`
- **演出**：
  1. `narrate`「御街的石板缝里长着草。走这条道的人，一年到头也不多。」
  2. `say`（传旨的人）「提督说了：京里的人都等着见你。」
  3. `menu`：「**你怎么办？**」
     - **「进京」>** `flag:'summoned'` + `+item palace_token`（① 应召线）→ `narrate`「公文袋里还夹着一块腰牌。」
     - **「撕了」>** `flag:'refused_summon'` + `-rep 朝廷 20` + **不给牌**（须走 ② 或 ③）
- ⚠️ 两条路**都能通到 5-6**，但**拒召的世界更凶**（见 §6 尾声差异）。

### 场 5-2 · 渡海 · 上岛

- `haitan_boat` 已有 action「**搜查**」→ **新增**「**渡海**」，`cond: {flag:'has_canjuan'}`
- `narrate`（海雾 / 船票 / 艄公 `npcv_229` 一句「岛上没有活人想你上去」）
- `taohuadao_dock` 已有 action「**回程**」→ **新增**「**入岛**」，`cond:{flag:'has_canjuan'}` → `flag:'taohua_road'`
- 落点：`taohua_road`

### 场 5-3 · 蛇阵 · 考题

- `taohuadao_she` **已有 action「破阵」**（现成！）→ 在其 `effects` 末尾**追加** `flag:'taohua_passed'`
- **设计定位**：蛇阵**不是关卡，是考题**——不要求打死任何蛇，只要求"找到不进蛇阵的活路"。
  > ⚠️ 若现有「破阵」的语义是"打过去"，本幕**只改 effects 文案 + 加 flag**（改成"绕过去"），**不改地图、不动 encounter**。
- `taohuadao_zhu` 已有 action「观竹」→ 可作为"考题的提示"（`narrate` 引导）
- 落点：`taohua_passed`

### 场 5-4 · 清音洞 · 三家之言

- **入口 action**：`taohuadao_qingyin`：「**问三句话**」，`cond: {flag:'taohua_passed', notFlag:'three_words'}`
- **三句话**（对应三位 Boss 的真相；**逐句都要落在玩家真经历过的事上**——这是 C3 后移门槛的目的）：
  1. `say`「**你打过的第一个人，不是最坏的。**」（↔ 一幕夜戏的官差 / 三幕的血刀老祖）
  2. `say`「**你练过的那半篇，是别人剪下来的。**」（↔ 三幕的假秘籍 / 四幕那一半被剪走的残卷）
  3. `say`「**收东西的人，从来不用手拿。**」（↔ 四幕末冯保那句"请你进京"）
  - **若 `jiuye_stood_aside`**（一幕夜戏你退了开）→ 第 1 句换成 `say`「**你站在旁边的那一晚，也是你的造化。**」（**记忆兑现**）
  - **若 `poisoned_xingxiu`**（三幕练了假秘籍）→ 第 2 句追加 `say`「**你练坏的那几天，现在还在你身上。**」
- **不给秘籍**（与"打 Boss 掉宝"划清界限）：`narrate`「他不给你书。他说书都是骗人的。」
- 落点：`three_words`

### 场 5-5 · 御道 · 那道影子

- **入口 action**：`palace_road`：「**过御道**」，`cond: {flag:'three_words', notFlag:'shadow_done'}`
- `depot_shadow` 的**常驻房就是这里**（**无需 `spawn`**）→ `combat` vs `depot_shadow`（**2 阶段：随影 / 分影**）
- `narrate`「他没有动。你发现**自己的影子先动了**。」
- 落点：`shadow_done`

### 场 5-6 · 太和殿 · 终局（三结局分岔）

- **入口 action**：`palace_hall`：「**面圣**」，`cond: {flag:'three_words', item:'palace_token', notFlag:'ending_done'}`
- 演出 + `menu` 见 **§6**。

## 5.6 本幕拉回路径（1 条 · 全剧第 7 条）

`npcv_082` 夏承志（**在 `palace_road` 御道边遇到** —— 原写 `palace_prison` 是循环依赖，见 §3.9-C11）——**替他瞒下递消息的事**（`arc.warm` +25；钩子 `hk_npcv_082_mibao`《埋在院里那份副本》）/ 替元怀瑾挡一句话（+30）/ 不在他面前提东厂（+15）
→ `+item palace_token` + `flag:'prison_intel'`（天牢门禁情报：**若在 5-6 选"拒交"，可用它把"另一个人"从天牢里带出来**，见 §6 尾声）。
堕落 = 把他递密报的事告诉元怀瑾，或**替他向东厂递一句真话**（`arc.break`）→ 腰牌线断（须走 ① 或 ②）。

## 5.7 本幕支线接口（留给 #115）

| 地点 | NPC | 接口 |
|---|---|---|
| 桃花岛 | `npcv_046` `npcv_047` `npcv_207` `npcv_210` `npcv_229` `npcv_139` `npcv_140` `npcv_278` | 岛上"不受体制约束的人"群像 → 黄药师那句话的旁证支线 |
| 皇城 | `npcv_019` `npcv_085` `npcv_151` `npcv_217` `npcv_283`（御道内人）· `npcv_018` `npcv_084` `npcv_150` `npcv_216` `npcv_282`（御花园内侍）· `npcv_020` `npcv_086` `npcv_152` `npcv_218` `npcv_284`（西六宫嫔妃）· `npcv_170`(长巷铁匠) `npcv_171`(内库郎中) `npcv_239`(织造局掌柜) `npcv_281`(天牢官吏) | 制度线（SPRINT-D）的天然接口：**"宫里的人怎么活"** |
| 天牢 | `npcv_082` `npcv_281` | 主线已用其 `hooks` → 支线写之后 |
| 武当 | `npcv_052` `npcv_118` `npcv_184` `npcv_250`（紫霄宫·宫中女官，**四个**） | 冲虚的 3 条 `仇` 边即指向其中三人（052/118/250）；「宫中的人怎么活」 |
| 少林 | `npcv_051` `npcv_117` `npcv_183` `npcv_249`（大雄宝殿·内侍，**四个**） | 与方证的 `友/仇` 混合边 → 塔中物线 |

> **人数口径（批次 6 · B19）**：上表两行是**四个**，不是「三个」——文案写到这两处一律写「四个」。
> （冲虚 `rel` 里 3 条 `仇` 是**关系边**数，与 4 个 NPC 不是一回事。）

---

# 6. 三结局 + 尾声文本（全剧收束）

- **分岔点唯一**：`palace_hall` 终局对峙时的一个 `menu`（**一次选择决定结局**，符合"第五幕才摊牌"的结构）。
- **落地写法**（`menu` 的选项可挂任意 effect；第三项只置 flag，进战斗后再落 `ending`）：

```text
menu: "最后一件事|交出残卷>ending jiaojuan 交了卷;交出抄本，原卷留己>ending banjiao 半交;不交>flag jujiao_ready"
```

- 「不交」**不直接给 ending**，而是先进入 **5-6 的 Boss 战**（`depot_master`）；**打赢后**才 `ending jujiao 拒交`（蓝图："拒交 = 拒绝 + 打赢提督"）。
- ⚠️ **选项门控**：`menu` 的选项**不能带 `cond`** → 用**两个 action 分流**：
  ① 「面圣」（`cond` 不含 `chen_chaoben`）只给 2 个选项（交卷 / 不交）；
  ② 「面圣（带抄本）」（`cond: {flag:'chen_chaoben'}`）给 3 个选项（含"半交"）。
  这样"半交"**只在玩家真的拿过那份抄本时才出现**——**门控即叙事**。

## 6.1 三结局表

| 结局 | args | 达成条件 | 尾声文案要点 |
|---|---|---|---|
| **交卷** | `['jiaojuan','交了卷']` | 持有 `wulin_zhenyi_canjuan`，选「交出」 | 残卷入东厂；朝廷"销毁邪功"实为据为己有；**你成了功臣，天下骂你** |
| **拒交** | `['jujiao','拒交']` | 选「不交」**且打赢** `depot_master` | 上通缉名单；恶名大涨，但**武当 / 少林 / 丐帮派人来找你** |
| **半交** | `['banjiao','半交']` | 持有 **原卷** + **`chen_chaoben`**（三幕 3-0 陈语冰的抄本流向），交出抄本、原卷留己 | **最难达成**；江湖既不记功也不记过，你只是从前行走 |

## 6.2 尾声文本（effects 规格 · **不给大团圆**）

**共用开头**（三条路都先走这段）：
1. `narrate`「太和殿比你想的空。龙案后面那把椅子，漆掉了一块。」
2. `say`（冯保）「东西留下，人就还能站着走出去。」（**只对"交卷/半交"**；"不交"走战斗线，此句作为战前挑衅）

**① 交卷（`ending_jiaojuan`）**
- `narrate`「他把残卷收进袖里，很轻，像收起一张当票。」
- `say`「朝廷会把它烧了——当众烧。你可以在场。」
- `narrate`「三个月后，江南的书铺里摆出一本《武学正典》，序里有一行「奉敕编修」，署的是你的名字。」
- `narrate`「你成了功臣。街上有人朝你吐唾沫，也有人在夜里往你门口放酒。」
- `ending` `['jiaojuan','交了卷']`

**② 拒交（`ending_jujiao`）**
- （先 `combat` vs `depot_master`；赢 → 以下）
- `narrate`「他把刀扔在地上。刀很薄，掉下去的时候没有响。」
- `say`「你会后悔的。不是今天。」
- `narrate`「第二天，城门上贴了你的画像。写的是「盗取国典，格杀勿论」。」
- **若 `prison_intel`**（天牢拉回路径）→ 追加：`narrate`「你从天牢侧门带走了一个人。他没有谢你——他只是在走出巷口的时候，回头看了一眼。」
- `narrate`「半月后，武当的道士、少林的僧人、丐帮的弟子，先后敲开了你的门。他们都不说为了什么。」
- `ending` `['jujiao','拒交']`

**③ 半交（`ending_banjiao`）**
- `narrate`「你从袖里取出一卷抄本，纸是新的，字是别人的手笔——**抄的人手很稳**。」
- `say`（冯保）「……原卷呢。」
- `narrate`「你没有答。他看了你很久，最后把手缩了回去。」
- `narrate`「他没杀你。他不必——**一个手里什么都没有的人，是最好收拾的**。」
- `narrate`「从此你在江湖上走。不记你的功，也不记你的过。有人提起那一年的事，说的都是别人。」
- **若 `ren_pact`**（四幕欠了任我行）→ 追加：`narrate`「那个欠了人情的人，会在某一天来收账。你等着。」（**多一条未结的线**）
- `ending` `['banjiao','半交']`

**共用收尾**（三条路**共用同一句**，这是全剧的落点）：
- `narrate`「你名动天下。可江湖还是那个江湖——**下一个「你」，已经在路上了。**」
- `flag` `act5_done`

> **设计闭环**：三幕 3-0 的一条**可选拉回路径**（不告发陈语冰 → `chen_chaoben`）成了"最难结局"的钥匙；
> 一幕夜戏的一个选择（`jiuye_stood_aside`）、四幕的两次人情（`dongfang_pact` / `ren_pact`）、五幕的一条拉回（`prison_intel`）都在尾声里有回响。
> **一个"顺手做的好事"到第五幕才显出价值——这就是本剧"世界记得你"的叙事兑现。**

---

# 7. 工程落地注意 & 决定状态

## 7.1 落地铁律（二幕的血泪，别踩第二遍）

1. **`giver` 必须挂 `def.quests`**——`shaolin_fangzheng` 挂 `q_main_snow`、`mojiao_dongfang` 挂 `q_main_moye`、`nv_huang` 挂 `q_main_end`，否则对应幕第一段永远交不掉。
2. **幕末 flag 必须由上一幕 rewards 落下**——`q_main_snow` rewards 落 `act3_done` + `quest:['q_main_moye',0]`；`q_main_moye` rewards 落 `act4_done` + `quest:['q_main_end',0]`。
3. **cond 边用对象形式**——`palace_gate.e` 已是 `{to,cond,msg,travel}`；新写门禁**不要**写字符串。
4. **`hostile:true` 的 NPC 不能 `talk`**——`blood_saber` / `xingxiu_laoxian` / `mojiao_dongfang` / `depot_master` / `depot_shadow` 的对白一律走**房间 action**。
5. **`bossPhases` 的 phase0 `skill` 会自动预挂**（`combat.js:239`），第一阶段的招式必须写在 `phases[0].skill` 里，否则整场都用不出来。
6. **`mult` 的键**：`atk/def/dodge/speed` 是**倍率**；`reflect/lifesteal/armorPen/critRate` 是**绝对值**（基线为 0，"吸血三成"写 `{"lifesteal":0.3}`）。
7. **`menu` 的选项不能带 `cond`**——选项门控要**拆成两个 action**（见 §6 的"面圣 / 面圣（带抄本）"），或把 `-item` 放到 `menu` 之后的 effect 里。
8. **flag vs var 分工**：`flag` 表"发生过/没发生过"（本文全部用 flag）；`var`（`incvar`）表"次数/数量"。
9. **`spawn` 的第三个参数**（存活期）：`{type:'spawn',args:[npcId, roomId, minutes]}`，默认 2 分钟 → 4-6 的冯保与 5-5 之后要**留够时间**（建议 ≥10）。

## 7.2 决定状态（**C1–C10 已全部拍板，见 §2.9**）

- C1 方案 A ✅ · C2 摘 `ending` ✅ · C3 门槛后移 ✅ · C4 新增 `ren_woxing` ✅ · C5 新增两件物品 ✅ · C6 `bossPhases` ✅（`nv_huang` 转"备用彩蛋"）· C7 腰牌三条来路 ✅ · C8 统一"绣阁"（已回填 `design/10`）✅ · C9 一幕夜戏补场景 ✅ · C10 容错 ✅
- **新增待确认 1 条（本批提出）**：`nv_huang` 是否保留"可选切磋彩蛋"？**默认不做**（他是委托人）。

## 7.3 下一步

- 本批交付后，主线四幕的故事与数据接口**全部就位**；下一步是**工程按 §9 落地**，以及 **#115 支线**（按 §3.8 / §4.8 / §5.7 的接口写）。
- 若需要，我可以再补：**五幕各场的完整中文文案**（本文已给关键台词与演出骨架，逐字定稿可另开一稿）。

---

# 8. 新增数据总清单（**第三~五幕并入 · 工程照此建**）

## 8.1 任务（3 条）

| id | name | type | level | giver | 段数 | 入场 cond | rewards 关键项 |
|---|---|---|---|---|---|---|---|
| `q_main_snow` | 【主线】伪秘籍 | 主线 | 40 | `shaolin_fangzheng` | 7 | `act2_done` | `know_zhenyi` · `act3_done` · `quest ['q_main_moye',0]` · +exp12000 · +pot6000 · +title「闻腥者」 |
| `q_main_moye` | 【主线】黑木之崖 | 主线 | 50 | `mojiao_dongfang` | 6 | `act3_done` | `know_depot_master` · `act4_done` · `quest ['q_main_end',0]` · +exp20000 · +pot10000 · +title「上崖人」 |
| `q_main_end` | 【主线】江湖路远 | 主线 | 60 | `nv_huang` | 6 | `act4_done` | `ending_*` · `act5_done` · +exp30000 · +pot15000 · +title「名动天下」 |

**同时**：`shaolin_fangzheng` / `mojiao_dongfang` / `nv_huang` 三人的 `def.quests` 各追加对应任务 id。

## 8.2 NPC（1 个新增 + 1 个可选）

| id | 说明 | 必需？ | 规格 |
|---|---|---|---|
| `ren_woxing` | 任我行（第四幕 4-4） | **必需** | §4.4 的 JSON（含 `bossPhases`）；`room: mojiao_hall`；需补 A 层 `portrait` |
| `mob_xingxiu_dizi` | 星宿弟子（三幕 3-7 召唤） | 可选 | 若不做，**复用现成 `mob_mo_disciple`** |

## 8.3 物品（7 件新增 + 1 件消耗确认）

| id | name | 用途 | 必需？ |
|---|---|---|---|
| `wulin_zhenyi_canjuan` | 武林真意·残卷 | 四幕 4-5 获得；五幕三结局核心 | **必需** |
| `wulin_zhenyi_chaoben` | 武林真意·抄本 | "半交"结局交出物（可由 `chen_chaoben` 触发时生成） | **必需** |
| `xuedao_copy_half` | 血刀门·半卷抄本 | 三幕 3-4 | 必需 |
| `fake_manual` | 速成秘籍（伪） | 三幕 3-7 战利品/证物 | 必需 |
| `yu_ledger_item` | 盐场假账册 | 三幕 3-7 取证 | 必需 |
| `star_cure_item` | 星宿海解药 | 三幕 3-7 减负（由 `ruan_cure` 触发生成） | 必需 |
| `yuanhuai_stub` | 元怀瑾的书房副本 | 五幕 `npcv_082` 拉回的凭证（可选） | 可选 |
| `depot_token_half` | 半块东厂铜牌 | **已存在**；三幕 3-3 可被交出去（`-item`） | — |

## 8.4 skill（0~1 个）

| id | 说明 | 必需？ |
|---|---|---|
| `luoying_shenjian_zhang` | 落英神剑掌（仅当主人要"黄药师可选切磋彩蛋"时） | **默认不需要** |

## 8.5 房间 `actions`（新增/修改清单）

**第三幕（13 个）**：`shaolin_daxiong`「问缺卷」· `shaolin_cangjing`「看经架」· `road_beijiang_1`「看车辙」· `beijiang_shankou`「摸哨」· `beijiang_xuedao`「见刀主」· `beijiang_houzhai`「摸后寨」· `xiyu_shule`「问商队」· `xiyu_xingxiu`「见老仙」· `xixia_yanchang`「问煮盐人」· `road_xixia_1`「截信」· `jn_market_main`「问北线」· `jn_brothel_room`「问抄纸」· `jn_fruit_stall`「问解药」

**第四幕（8 个）**：`mojiao_shanmen`「闯山门」· `mojiao_hall`「过前殿」· `mojiao_shuangxiu`「上绣楼」/「见教主」/「翻绣架」/「下崖」· `mojiao_hall`「回大殿」· `jn_brothel_hall`「劝她」（`npcv_186` 行前场）

**第五幕（10 个）**：`palace_street`「拆公文」· `jn_yamen_office`「补个名分」· `palace_prison`「问夏承志」· `haitan_boat`「渡海」· `taohuadao_dock`「入岛」· `taohuadao_she`「破阵」（**改 effects**）· `taohuadao_qingyin`「问三句话」· `palace_road`「过御道」· `palace_hall`「面圣」/「面圣（带抄本）」

**C9 第一幕（1 个）**：`road_huashan_1`「夜宿山道」（见 §2.9.2）

> **每个 action 必须带**：`cmd`（玩家输入的词）+ `label` + `keywords` + `cond`（flag 门控）+ `failMsg`（**不满足时给一句人话**，别让玩家对着空气发呆）+ `effects`。
> **合计 32 个 action**（三幕 13 · 四幕 8 · 五幕 10 · 一幕 1）。**全图不改任何出口**——**零反向边风险**（`design/19` 的 R5 硬断言不受影响）。

## 8.6 flag 总表（三~五幕新增）

**第三幕**：`snow_lead` `zhengju_shaolin` `road_found` `pass_shankou` `shankou_quiet` `blood_deal` `blood_deal_trade` `depot_token_given` `xuedao_knows_token` `blood_saber_hostile` `xuedao_copy` `blood_saber_down` `blood_saber_ally` `shule_to_xingxiu` `poisoned_xingxiu` `refuse_fake` `zhenyi_bait` `xingxiu_down` `know_zhenyi` `act3_done` + 行前场成对：`npv180_warm`/`npv180_broken` `252_warm`/`252_broken` `npv090_warm`/`npv090_broken` `npv248_warm`/`npv248_broken` `changfu_lead` + 路径：`yue_zhi_road` `chen_chaoben` `ruan_cure` `yu_ledger`

**第四幕**：`sentinel1` `sentinel2` `moye_sentinel` `moye_backroad` `buju` `dongfang_talks` `dongfang_pact` `dongfang_hostile` `dongfang_down` `ren_appears` `ren_pact` `ren_refused` `has_canjuan` `know_depot_master` `act4_done`

**第五幕**：`summoned` `refused_summon` `taohua_road` `taohua_passed` `three_words` `shadow_done` `prison_intel` `jujiao_ready` `ending_jiaojuan` `ending_jujiao` `ending_banjiao` `act5_done`

**C9 第一幕**：`jiuye_done` `jiuye_fought` `jiuye_stood_aside`

> 共 **62 个新 flag**（三幕 34 + 四幕 15 + 五幕 12 + 一幕 3，去重后）。**全部走 `flag`（不用 `var`）**，除了 §7.1-8 提到的"次数类"。

---

# 9. 给工程的落地清单（**每条：改哪个文件 / 什么位置 / 要什么数据**）

> 本清单把**所有需要代码或数据配合的项**集中在此。每条都标了依据章节，不用回头翻全文。
> 优先级：**P0 = 不改就落地不了**；P1 = 影响体验/一致性；P2 = 可选。

| # | 项 | 改哪个文件 | 什么位置 | 要什么数据 | 依据 | 优先级 |
|---|---|---|---|---|---|---|
| **E1** | **C1** `defeatLegend` 池换人 | `game/src/core/engine.js` | `:63-66` 的数组 | 改为 `['emei_miejue','taixu_hermit','shenni']` | §2.9 | **P0** |
| **E2** | **C1 附带** 修"代码 6 人 vs 描述 4 人"不一致 | `game/data/60_quests.json` | `q_main_jianghu` stage3 的 `desc` | 描述改为与新池一致的三人（灭绝师太 / 太虚居士 / 神秘老僧） | §2.9 | **P0** |
| **E3** | **C1 附带** 给 `taixu_hermit` 补 `tier` | `game/data/40_npcs.json` | `taixu_hermit` | `tier: "A"`（**现状 `undefined`**，而他在新池里） | §2.9 / 实测 | P1 |
| **E4** | **C2** 摘掉第一幕的 `ending` | `game/data/60_quests.json` | `q_main_jianghu.rewards`（现 **:1153-1158**） | **删除** `{"type":"ending","args":["jianghu_end","江湖路远"]}`，改为一条 `narrate`：「江湖很大。你只是刚学会怎么在里头站住。」 | §2.9 | **P0** |
| **E5** | **C3+C9** 门槛后移 + 铜牌改由夜戏发出 | `game/data/60_quests.json` | `q_main_jianghu` 的 `stages[4]`（击败名宿）与 `stages[5]`（绝顶内功）的 `cond` | `stages[4].cond` 加 `{flag:'act4_done'}`（`and` 包裹）；**并把 `rewards` 里的 `flag know_east_depot` / `+item depot_token_half` / `quest ['q_main_sect',0]` 三条搬走**（移到 E6） | §2.9.1 | **P0** |
| **E6** | **C9** 第一幕夜戏（补场景） | `game/data/50_map.json` + `60_quests.json` | `road_huashan_1` **新增 1 个 action**「夜宿山道」；**不动任何出口** | action 的 `cond: {and:[{hasSect:true},{notFlag:'jiuye_done'}]}`；`effects` 按 §2.9.2 的 8 步（含 `menu` 抉择、`combat` vs `mob_soldier`、`+item depot_token_half`、`flag know_east_depot`、`quest q_main_sect 0`）。**✅ 逐字文案已就绪 → `design/24-mainline-script.md` 的「第一幕补场 · 场 1-5 · 夜宿山道」（本稿开头，含「动手 / 退开」两条完整分支）** | §2.9.2 / `design/24` 场 1-5 | **P0** |
| **E7** | **C4** 新增 NPC 任我行 | `game/data/40_npcs.json` | 顶层 `npcs` 追加 | §4.4 的完整 JSON（含 `bossPhases`）+ 一份 A 层 `portrait`（13 字段，照 `depot_master` 的结构写） | §4.4 / §8.2 | **P0** |
| **E8** | **C5** 新增两件核心物品 | `game/data/20_items.json` | 顶层 `items` 追加 | `wulin_zhenyi_canjuan`（`type:'book'`,`noSell:true`,`tags:['mainline','clue','legend']`,`quality:'legend'`，**desc 必须写"残缺，只够看半篇"**）+ `wulin_zhenyi_chaoben` | §8.3 | **P0** |
| **E9** | **C5 附带** 三幕 5 件物品 | `game/data/20_items.json` | 同上 | `xuedao_copy_half` `fake_manual` `yu_ledger_item` `star_cure_item`（+可选 `yuanhuai_stub`） | §8.3 | P1 |
| **E10** | **C6** 三幕两个 Boss 加 `bossPhases` | `game/data/40_npcs.json` | `blood_saber` / `xingxiu_laoxian` | §3.4 的两份 JSON（`lifesteal` 表"化血/化功"；`summon` 用 `mob_bandit_chief` / `mob_mo_disciple`） | §3.4 | **P0** |
| **E11** | **C6 附带** `nv_huang` 可选彩蛋 | `game/data/40_npcs.json` + `20…skills` | `nv_huang.bossPhases` + skill | §5.4 的 JSON + skill `luoying_shenjian_zhang`。**默认不做** | §5.4 | P2 |
| **E12** | **C7** 腰牌三条来路 | `game/data/50_map.json` | `palace_street`「拆公文」/ `jn_yamen_office`「补个名分」/ `palace_prison`「问夏承志」三个 action | 三者均含 `+item palace_token`（物品**已存在**，只需给定获途径） | §5.3 | **P0** |
| **E13** | 三个主线任务的**新增** | `game/data/60_quests.json` | 顶层 `quests` 追加 | §8.1 的 `q_main_snow` / `q_main_moye` / `q_main_end`（7/6/6 段） | §8.1 | **P0** |
| **E14** | 三个委托人**挂任务** | `game/data/40_npcs.json` | `shaolin_fangzheng` / `mojiao_dongfang` / `nv_huang` 的 `quests` 数组 | 各 `+=` 对应任务 id（**不挂 = 交不掉**） | §7.1-1 | **P0** |
| **E15** | 三~五幕的 **28 个房间 action** | `game/data/50_map.json` | 对应房间的 `actions` 数组 | §8.5 的清单（每项：`cmd/label/keywords/cond/failMsg/effects`） | §8.5 | **P0** |
| **E16** | 五幕**尾巴**：`ending` 三条 + `menu` 门控 | `game/data/50_map.json` + `60_quests.json` | `palace_hall` 的「面圣」/「面圣（带抄本）」两个 action | §6 的 `menu` 写法 + 三份尾声文本（按"两 action 分流"门控"半交"） | §6 | **P0** |
| **E17** | **C8** 文档回填 | `design/10-mainline-story.md` | §2 三幕节点 3-6 | 「残卷在**绣阁**」（原文"双修崖"） | §2.9 | P1（**叙事侧已做**） |
| **E18** | 反归档：`design/10` §6 实施顺序 | `design/10-mainline-story.md` | §6 第 5/6 条 | 标注"三~五幕细纲见 `design/21-mainline-act3-5.md`" | — | P2（**叙事侧已做**） |
| **E19** | 数值 | `design/05-balance-spec.md` | — | C3 的"绝学获取曲线"、三~五幕的 exp/pot/难度 | §2.9.1 | P1 |

**回归建议（工程侧）**：
- 每个 `action` 加**一条 smoke 断言**（"cond 满足时 effects 全跑完、flag 确实置位"），照 `tools/smoke-act2.js` 的写法。
- **五个 Boss**（`blood_saber` / `xingxiu_laoxian` / `mojiao_dongfang` / `ren_woxing` / `depot_master`）各加一条"三阶段确实切换 + 战斗结束复位"的断言（照 `tools/smoke-boss.js`）。
- **C2 专项回归**：断言「第一幕走完**不会**产生 `ending_*` flag」——这条现在会红，修完才绿。
- **C6 专项回归**：`palace_token` 三条来路**各有一条断言**（三条都能真拿到）。
- **严格反向边**：本方案**不动任何出口**，`design/19` 的 R5 硬断言**应保持全绿**；若有异常，一定是别的改动引入的。

---

# 附：本文用到的实测命令（可复现）

```js
const {GameEngine} = require('./game/src/core/engine.js');
const e = new GameEngine({seed: 20261010}); e.boot();
const w = e.world;
const rooms = w.data.rooms, npcs = w.data.npcs, items = w.data.items, Q = w.data.quests, S = w.data.skills;
Object.keys(rooms).length;                                  // 引擎口径 317（50_map 口径 312）
Object.keys(w.data.regions || {}).length;                   // 34
Object.keys(npcs).filter(id => npcs[id].bossPhases);        // mojiao_dongfang / depot_master / depot_shadow（三幕两个待补 → C6）
Object.keys(npcs).filter(id => (npcs[id].name||'').includes('任我行'));   // []  ← C4
Object.keys(items).filter(id => /zhenyi|canjuan/.test(id));               // []  ← C5
JSON.stringify(rooms.palace_gate.exits.e);                  // cond 对象边 ← C7
// 连通性（无孤岛）：从出生点 BFS 到各幕舞台
// rod_jiangnan_1 → beijiang_shankou / xiyu_xingxiu / mojiao_shuangxiu / taohuadao_qingyin / palace_hall / palace_prison  全部可达 ✅
```

- **严格反向边审计**：遍历 `rooms[id].exits`，校验 `rooms[to].exits[OPP[d]] === id`（**本文 §1.2 与 §4.2 / §5.2 引用的房间全部通过**；全图其余见 `design/19-map-rebalance.md` §7.1）。
- `defeatLegend` 池：`game/src/core/engine.js:63-66`。`ending` 效果：`game/src/core/modapi.js:565-570`。`menu`：`:542-554`。`spawn/despawn`：`:487-488`。Boss 三阶段：`game/src/core/combat.js:216-283`。
- **id 自查脚本**：抽取本文所有反引号 token → 逐个比对 `rooms / npcs / items / quests / skills / portraits-new.json 的 hook id`。

*本文 r2：第三幕细纲（r1）+ 第四、五幕细纲 + 三结局与尾声文本 + §8 新增数据总清单 + §9 工程落地清单。C1–C10 已按主理人决定落地为文档；下一步由工程按 §9 执行。*


## 3.9 细纲回填记录（依 `design/24-mainline-script.md` 文案复查）· **r2.1**

> 写逐字文案时撞出来的 10 处「细纲 vs 文案」差异。**team-lead 已批 C-1~C-5 全部回填；C-6~C-10 为二批新发现，一并登记。**
> **凡标「原文作废」的，工程以本节为准，不要再按旧文实现。**

| # | 差异 | 决定 | 最终实现（**以它为准**） | 状态 |
|---|---|---|---|---|
| **C-1** | 3-0 统称"行前四处"，但 `npcv_248` 俞初 常驻 `road_xixia_1`（**西夏官道，不在江南**） | **改称「四处人情」** | 三处在江南＝真行前；一处在西夏＝在路上。表与小节标题已改（见 §3.2 / §3.3） | ✅ 已回填 |
| **C-2** | 三处"堕落分支"原文写成跨图动作（说给姑苏的毛清等），可选场太重 | **采纳文案改法** | 改为**触画像 `voice.taboo` 就地触发**：乐知提"那面旗是华山的"／陈语冰把纸拿给楼下花厅的梅拾（`jn_brothel_room` 的 `s` 即 `jn_brothel_hall`，同一步楼内）／阮听问箱子／俞初提常拂。效果等价（`*_broken` + 现钱/恶名 + 断线），路径更短。**细纲原文作废。** | ✅ 已回填 |
| **C-3** | "以抄本换铜牌"要求**先摸后寨再谈判**，但细纲没写顺序 → 工程按固定顺序实现会让该选项**永远出不来** | **必须补顺序说明** | `beijiang_houzhai`（场 3-4）的 `cond` 只有 `pass_shankou`，**玩家本就可以先去后寨**。**两处顺序都通**：<br>· 先 3-4（摸寨）后 3-3 → 3-3 出现「以抄本换」选项<br>· 先 3-3 后 3-4 → 走"交铜牌"或"硬来"<br>**工程实现时 3-4 的 cond 不得加 `blood_deal` 前置**（否则选项二永不出现）。 | ✅ 已回填 |
| **C-4** | 3-2 打输会 `-item depot_token_half`，细纲没写"没铜牌的玩家还剩什么" | **补出路** | 铜牌被搜走 ⇒ **跳过 3-3 的谈判，直接进 `blood_saber_hostile` 战斗**（不需筹码）；此后铜牌不再回到玩家手里。**4-6 冯保台词有对应变体**（读 `depot_token_given`）。 | ✅ 已回填 |
| **C-5** | `xixia_yanchang` 的取证 `cond` 锁死在 `xingxiu_down` | **批准放宽** | `cond:{or:[{flag:'xingxiu_down'},{flag:'zhenyi_bait'}]}`（已内联改，见 §3.3 场 3-7） | ✅ 已回填 |
| **C-6** | §6.2 原写"三结局**共用**同一句收尾" | **拆开** | 三版尾声**各写各的收尾**（`design/24` 附 G）：交卷收在"书加印七次＋名字旁一个墨点"／拒交收在"三拨人＋小孩念名字"／半交收在"笔悬着没落＋连你叫什么都没记住"。**细纲"共用收尾"一句作废。** | ✅ 二批已定 |
| **C-7** | 4-6 冯保台词需要读两个 flag，细纲没写 | **补** | 4-6 台词分两版：持 `depot_token_half` →「留着吧。厂里的东西，认人不认牌。」／`depot_token_given` →「你身上本来该有块牌子。现在在别人手里。不老实。」（**三幕抉择①在四幕幕末被世界记住**） | ✅ 二批已定 |
| **C-8** | 4-0 行前场（`npcv_186`）需要一个前提判断 | **补前提** | 4-0 的台词（"崖上的路""教主左肩旧伤"）**只对"尚未与东方不败交手"的玩家有意义**；C1 收窄 `defeatLegend` 池后**默认不会发生冲突**，此条仅为保险 | ✅ 二批已定 |
| **C-9** | 5-5 细纲只有一战，无微解法 | **补** | 加选项「（不动。等他自己露出来）」→ `+buff`（半步先机）——让"不先动手"成为**有回报的打法**，贴合影子的画像（"威胁用站位表达"） | ✅ 二批已定 |
| **C-10** | 5-3"破阵"两种过法未记副作用 | **补** | 硬闯 → `taohua_brute`（5-4 黄药师开场会点你"更没有耐心"）；绕行看竹 → 无 flag。`taohua_passed` 两条路都给 | ✅ 二批已定 |

| **C-11** | 🔴 **腰牌来路③原定在 `palace_prison`，造成循环依赖**：天牢只能从 `palace_hall` 的 `nw` 进，而那条边**要腰牌** → "没牌进不去天牢，进不去天牢拿不到牌"，**在物理上不可达** | **改舞台** | 路线③ 从 `palace_prison` **挪到 `palace_road`（御道 · 门外 · 无需腰牌）**：夏承志"押着文书出宫、在御道边蹲着等人"。§5.3 与 §5.6 已改。**这是"拒召进京"路线的生死点**——不改，拒召的玩家只剩路线②一条生路。 | ✅ 已回填 |

**净影响（工程只需知道这四条）**：① 3-4 的 `cond` **不要**加前置（C-3）；② 3-7 取证的 `cond` 用 `or`（C-5）；③ 4-0 的"堕落/拉回"触发点按 `design/24` 的 `menu` 写（C-2）；④ **腰牌路线③ 的 action 挂 `palace_road`，不是 `palace_prison`**（C-11）。

**文案稿**：`design/24-mainline-script.md`（第三~五幕逐字文案，**6352 字 / 26 场**；26 场里 25 场引擎全绿，唯一例外 3-0-B 已立**误报豁免记录**）。
