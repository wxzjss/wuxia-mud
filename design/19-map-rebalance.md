# B13 世界区块重设计（map-rebalance）

> 上位：`design/12-owner-bug-list.md` B13（严重度 **高**）；本文件是 `design/09-map-district-allocation.md` 的**修订版**（09 定的是"先有地"，19 定的是"地把房摆匀"）。
> 输入：`design/10-mainline-story.md`（五幕舞台）、`tools/map-check.js`（八条断言 / 6278 项）。
> 输出类型：**方案文档**。本文不写代码、不改 `game/data/*.json`、不 commit。工程按 §6 清单执行。
> 最后更新：2026-10-11 · 作者：文策渊（设计+叙事）

---

## 0. 摘要（先给结论）

| 项 | 现状 | 目标 | 说明 |
|---|---|---|---|
| **江南（`jiangnan`）房间** | **56** | **27** | 出生地 + 第一幕舞台，砍到主城规模，但保住全部主脉络 |
| 江南富户住宅 | **31 座**（`jn_home_01..30` + `jn_rich_house`） | 留 2 座 · 迁 24 座 · 删 5 座 | 迁往 7 个"配得上富户"的城市 |
| 空壳区域（1~3 房） | **9 个**（`many` `secret` `jinguo` `xiake` `xixia` `haitan` `beijiang` `gusu` + 2 房档） | 全部补到 **3~5 房的最低可用规模** | 不做"永不进去的死区" |
| **总房间数** | **291**（`50_map.json` 口径，map-check 认这个数） | **312** | +21（+7.2%），详见 §0.1 |
| region 数 | **34** | **34（一个不增不减）** | map-check 断言 3 硬编码 `=== 34` |

### 0.1 为什么总数要 +21，而不是持平

- 江南砍掉 **29** 间（56→27，其中 24 座宅院"搬家"、5 座拆除）——**净腾出 29 间空间**。
- 但这 29 间里，**24 间是"搬家"**（江南删 1、目标城加 1，总数净 0）；真正能匀给别处的是 **5 间**。
- 而"消除 9 个空壳 + 7 城各配一条宅巷"至少需要 **26 间**（6 巷 + 20 秘境/后山房）。
- 26 − 5 = **净增约 21 间**。这不是"又灌水"，是**把过去全堆在江南的街区配额，按天下九州的真实分量重新切**。
- 数值已在脚本里对过账：`291 − 29(江南) + 24(迁宅) + 6(宅巷) + 20(补建) = 312`。✅

> ⚠️ 工程执行时总数允许 ±4 浮动（各城宅巷数量可微调），但 **region 数必须恒为 34**，且不得靠"造假空房"凑数（那是 09 文档已经拆掉的 354 间填充物的老病根）。

---

## 1. 实测现状（真数据，非过时文档）

### 1.1 两个口径，先分清

| 口径 | 房间 | region | 谁在管 |
|---|---|---|---|
| `game/data/50_map.json`（**规范文件**） | **291** | **34** | `tools/map-check.js` 只读它，八条断言全绿 |
| 引擎合并后全量（含 mod/demo） | **296** | **35** | 多出 `tingyu`(听雨山庄，demo map) 4 房 + `test_room`(测试房间) 1 房 |

**结论**：动房间只动 `50_map.json`；`tingyu` 是 demo 层不要碰；`test_room` 建议顺手删（见 §6.5）。

### 1.2 房间数排行（`50_map.json`）

| region | 房 | region | 房 | region | 房 | region | 房 |
|---|---|---|---|---|---|---|---|
| `jiangnan` | **56** | `wudang` | 7 | `miaojiang` | 4 | `xiake` | 2 |
| `market` | 20 | `qinglou` | 7 | `xiyu` | 4 | `jinguo` | 2 |
| `wild` | 15 | `tangmen` | 6 | `gumu` | 4 | `many` | **1** |
| `huashan` | 15 | `taohuadao` | 6 | `haitan` | 3 | `secret` | **1** |
| `palace` | 14 | `harbor` | 6 | `beijiang` | 3 | | |
| `cunzhen` | 13 | `gaibang` | 5 | `gusu` | 3 | | |
| `yamen` | 12 | `dali` | 4 | `xixia` | 2 | | |
| `farmland` | 12 | `miaojiang` | 4 | | | | |
| `shuyuan` | 11 | `mojiao` | 4 | | | | |
| `shaolin` | 9 | `emei` | 8 | `luoyang`/`changan`/`chengdu`/`xiangyang` | 各 8 | | |

### 1.3 江南 56 间的真实构成

| 类别 | 房间 | 数量 | 外部引用（quest/NPC/代码） |
|---|---|---|---|
| 主城街巷（**必保**） | `jiangnan_gate/street/market/smithy/inn/qiao/east_road/west_road/hill/temple/brothel` + `palace_street` | 12 | **极多**（`jiangnan_market` 被 21 个 NPC + 9 个 quest 引用） |
| 官道（**必保**） | `road_jiangnan_1`（**出生点**）/`road_jiangnan_2` | 2 | `startRoom` + `tutorial.js` + `smoke-b9-intro.js` 断言 |
| 民居巷道（**必保**） | `jn_resident_1/2/3` | 3 | 各驻 1 个 NPC；`world.js` 的 `PLAY_ROOMS` 含 `jn_resident_1` |
| 钱府（**必保**） | `jn_rich_house/hall/garden` | 3 | 各驻 1 个 NPC（谈绿萼/庞轻舟/史倦客） |
| 铺面（**必保**） | `jn_smith_inner/pharmacy/pharmacy_back/misc_shop/carriage` | 5 | `jn_misc_shop`/`jn_carriage` 各驻 NPC |
| 私宅（**必保**） | `hm_npcv_027`（任停的家） | 1 | A/B 层 `private` 房，见 §7 |
| **百家姓宅院（填充物）** | `jn_home_01..30` | **30** | **对外零引用**（脚本扫全库：0 quest / 0 NPC / 0 代码引用） |

> **一句话点破病根**：`jn_home_01..30` 是当年 `gen-map.js` 按百家姓批量生成的**纯填充房**，全图 62 座"疑似宅院"里 31 座压在江南，玩家进江南看到的是"三十个一模一样的某某宅"。**它们一个 NPC 都不住、一条任务都不用**——这正是本次可安全拆除的靶子。

---

## 2. 设计原则（给方案一个可评审的骨架）

1. **按"天下"分量分配，不按生成顺序堆。** 每个 region 的房间数应当反映它在**五幕故事 + 经济 + 门派体系**里的分量，而不是"谁先生成谁多"。
2. **出生地要厚，但不能靠空房厚。** 江南是第一幕舞台，**主脉络一间不删**；砍的只是填充宅院，并把它匀给真有戏的地方。
3. **富户住宅只配"配得上的城"**：大城 / 商埠 / 官府 / 世家所在——**荒郊、秘境、魔教窝点不配民宅**。
4. **没有"永不进去的死区"。** 每个 region 要么有内容（≥最低可用规模），要么**明确声明它是"路过型小场景"并给出保留理由**（§5）。
5. **改动可被现有断言验证。** 一切以 `tools/map-check.js` 八条断言 + 严格反向边审计为准（§7、§8）。

---

## 3. 区块再平衡目标表（34 区 · 逐区给依据）

> 分层建议（工程排布与前端展示可用）：主城/都 12–27 · 门派 4–15 · 村落 12–13 · 野外/边塞 4–15 · 秘境/禁区 3–4 · 娱乐 7。

| region | 名称 | tier | 现 | **目标** | Δ | 依据 |
|---|---|---|---|---|---|---|
| `jiangnan` | 江南 | town | 56 | **27** | **−29** | 出生地+第一幕，保主脉络、砍填充宅院（§6） |
| `market` | 东市 | town | 20 | **20** | 0 | 37 个 NPC 常驻，**已很密，不动**（动了会大面积挪 NPC） |
| `wild` | 荒野 | wild | 15 | **15** | 0 | 含 7 处真野外 + 8 处"城西近郊"，维持（§8 已知问题） |
| `huashan` | 华山 | sect | 15 | **15** | 0 | 门派样板区，含 4 座 A 层私宅，维持 |
| `palace` | 皇城 | capital | 14 | **14** | 0 | 皇都禁宫，维持 |
| `cunzhen` | 青溪村 | village | 13 | **13** | 0 | 6 座村户（无 NPC），村落样本，维持 |
| `yamen` | 衙门府 | court | 12 | **15** | **+3** | 京畿官府，**迁入 3 座官吏宅**（孙/蒋/孙家） |
| `farmland` | 田野 | village | 12 | **12** | 0 | 维持 |
| `shuyuan` | 白鹿书院 | town | 11 | **11** | 0 | 维持 |
| `shaolin` | 少林 | sect | 9 | **10** | **+1** | 补 `shaolin_houshan`（后山，藏经阁剧情延伸） |
| `emei` | 峨眉 | sect | 8 | **9** | **+1** | 补 `emei_houshan`（后山） |
| `luoyang` | 洛阳城 | town | 8 | **13** | **+5** | 九朝古都·豪门多 → **迁入 4 座富户** + 牡丹巷 |
| `changan` | 长安城 | capital | 8 | **13** | **+5** | 天子脚下·勋贵多 → **迁入 4 座富户** + 宦宅巷 |
| `chengdu` | 成都府 | town | 8 | **12** | **+4** | 锦官富庶 → **迁入 3 座富户** + 锦里宅巷 |
| `xiangyang` | 襄阳城 | town | 8 | **12** | **+4** | 军镇·将门 → **迁入 3 座富户** + 将门巷 |
| `wudang` | 武当 | sect | 7 | **8** | **+1** | 补 `wudang_houshan`（后山） |
| `qinglou` | 醉春楼 | fun | 7 | **7** | 0 | 29 个 NPC，维持 |
| `tangmen` | 唐门 | sect | 6 | **6** | 0 | 维持 |
| `taohuadao` | 桃花岛 | sect | 6 | **6** | 0 | 维持 |
| `harbor` | 江口码头 | town | 6 | **11** | **+5** | **商埠** → **迁入 4 座海商宅** + 货栈后街 |
| `gaibang` | 丐帮 | sect | 5 | **5** | 0 | 维持 |
| `dali` | 大理 | sect | 4 | **5** | **+1** | 段氏王府，补 `dali_wuhua`（五华楼） |
| `miaojiang` | 苗疆 | sect | 4 | **5** | **+1** | 补 `miaojiang_zhai`（苗寨吊脚楼群） |
| `xiyu` | 西域 | wild | 4 | **5** | **+1** | 第三幕舞台，补 `xiyu_shule`（疏勒镇） |
| `gumu` | 谷魔窟 | mad | 4 | **4** | 0 | 维持（秘境型） |
| `mojiao` | 黑木崖 | mad | 4 | **4** | 0 | 维持（第四幕有绣阁 boss，房少但重） |
| `haitan` | 梅海滩 | wild | 3 | **4** | **+1** | 补 `haitan_village`（渔村），去掉"3 房空壳" |
| `beijiang` | 北疆·雪谷 | wild | 3 | **5** | **+2** | **第三幕主舞台** → 补 `beijiang_shankou`（山口）+ `beijiang_houzhai`（血刀寨后寨） |
| `gusu` | 姑苏 | town | 3 | **7** | **+4** | **慕容世家**所在 → **迁入 3 座宅**（含慕容别院）+ 世家巷 |
| `xixia` | 西夏·盐池 | wild | 2 | **3** | **+1** | 补 `xixia_yanchang`（盐场），成"官道+盐场+冰窖"三点 |
| `xiake` | 侠客岛 | realm | 2 | **4** | **+2** | 秘境补足：石壁 + 内堂 + **石室 + 渡口** |
| `jinguo` | 锦国旧陵 | realm | 2 | **4** | **+2** | 秘境补足：故城 + 暗道 + **石室 + 主墓** |
| `many` | 蛮荒 | realm | 1 | **4** | **+3** | 空壳→秘境：草原 + **毒沼 + 野人寨 + 上古遗迹** |
| `secret` | 地下黑市 | secret | 1 | **4** | **+3** | 空壳→禁区：黑市 + **鬼市 + 暗巷 + 囚笼** |
| | **合计** | | **291** | **312** | **+21** | |

---

## 4. 富户住宅迁移方案（31 座逐座去向）

### 4.1 原则：谁配得上富户

| 判据 | 收（✅） | 不收（❌） |
|---|---|---|
| 大城 / 都 | `luoyang` `changan` `chengdu` `xiangyang` | — |
| 商埠 | `harbor`（江口码头） | — |
| 官府 | `yamen`（官吏宅第，非"富户"） | `palace`（禁宫，不设民宅） |
| 世家 / 门派山门 | `gusu`（慕容世家） | — |
| 荒郊 / 秘境 / 邪派 | — | `wild` `beijiang` `xixia` `many` `haitan` `xiake` `jinguo` `secret` `gumu` `mojiao` |

### 4.2 31 座去向

**留在江南：2 座（4 间房）**
| 原 id | 处理 | 理由 |
|---|---|---|
| `jn_rich_house`+`jn_rich_hall`+`jn_rich_garden`（钱府，3 间） | **保留** | 江南首富，且 3 个 NPC（谈绿萼/庞轻舟/史倦客）常驻 |
| `jn_home_01`（张宅，1 间） | **保留** | 作"柳巷老户"样本，挂 `jn_resident_1`，给民居区一个落点 |

**迁往他城：24 座**（每座 = 江南删 1 + 目标城加 1，总数净 0）
| 城市 | 座数 | 新宅 id / 名字 |
|---|---|---|
| `luoyang` 洛阳 | 4 | `ly_home_01` 洛阳·王宅 / `ly_home_02` 洛阳·李宅 / `ly_home_03` 洛阳·沈宅 / `ly_home_04` 洛阳·韩宅 |
| `changan` 长安 | 4 | `ca_home_01` 长安·郑宅 / `ca_home_02` 长安·陈宅 / `ca_home_03` 长安·秦宅 / `ca_home_04` 长安·卫宅 |
| `chengdu` 成都 | 3 | `cd_home_01` 成都·杨宅 / `cd_home_02` 成都·朱宅 / `cd_home_03` 成都·许宅 |
| `xiangyang` 襄阳 | 3 | `xy_home_01` 襄阳·周宅 / `xy_home_02` 襄阳·吴宅 / `xy_home_03` 襄阳·冯宅 |
| `harbor` 码头 | 4 | `hb_home_01` 码头·褚宅 / `hb_home_02` 码头·尤宅 / `hb_home_03` 码头·陈宅 / `hb_home_04` 码头·黄宅 |
| `gusu` 姑苏 | 3 | `gs_home_01` 姑苏·**慕容别院** / `gs_home_02` 姑苏·刘家院 / `gs_home_03` 姑苏·赵家小院 |
| `yamen` 衙门府 | 3 | `ya_home_01` 衙后·孙宅 / `ya_home_02` 衙后·蒋宅 / `ya_home_03` 衙后·孙家院 |
| | **24** | |

**就地拆除：5 座**（位置最差、名目重复的城西房）
`jn_home_04` 赵宅 · `jn_home_27` 城西·李家 · `jn_home_28` 城西·周家 · `jn_home_29` 城西·吴家 · `jn_home_30` 城西·郑家

> 校验：留 2 + 迁 24 + 删 5 = **31** ✅（`jn_home_01` 留，`jn_home_02..30` 共 29 座参与迁/删）

---

## 5. 空壳 / 稀薄区域处置

| region | 现 | 处置 | 补建 / 保留理由 |
|---|---|---|---|
| `many` 蛮荒 | 1 | **补到 4** | "realm（秘境）"tier 却只有 1 间过路草原 = 假秘境。补 `many_pool` 毒沼 / `many_camp` 野人寨 / `many_ruin` 上古遗迹 |
| `secret` 地下黑市 | 1 | **补到 4** | A 层 NPC 独眼老刘（`wen_black`）的窝点，1 间撑不起"什么都能买卖"的设定。补 `secret_guishi` 鬼市 / `secret_anxiang` 暗巷 / `secret_cage` 囚笼（呼应掳人系统 #111） |
| `jinguo` 锦国旧陵 | 2 | **补到 4** | 秘境三拍：买路 → 机关 → 宝藏。补 `jinguo_shi` 石室 / `jinguo_tomb` 主墓 |
| `xiake` 侠客岛 | 2 | **补到 4** | 侠客行传说地，2 间浪费。补 `xiake_dong` 石室 / `xiake_dukou` 渡口 |
| `xixia` 西夏·盐池 | 2 | **补到 3** | 边塞小场景，够用即可。补 `xixia_yanchang` 盐场（"煮盐人比打仗人多"落地） |
| `haitan` 梅海滩 | 3 | **补到 4** | 补 `haitan_village` 渔村（退潮赶海的生活味） |
| `beijiang` 雪谷 | 3 | **补到 5** | **第三幕主舞台**，血刀门必须"三道哨卡"。补 `beijiang_shankou` 山口 / `beijiang_houzhai` 后寨 |
| `gusu` 姑苏 | 3 | **补到 7** | **慕容世家**是金庸名门，3 间太薄。迁入 3 宅 + 补 `gusu_zhai_lane` 世家巷 |

**"路过型小场景"（明确声明保留、不扩）**：`gumu`（4 间，活死人墓本就该小而秘）· `mojiao`（4 间，黑木崖"日头照不到"，房少正合其阴冷，第四幕 boss 在此）· `tangmen`（6 间，门派小而精）· `gaibang`（5 间，破庙本就寒酸）。
→ 这四个**不补**，但**也不是空壳**：都有人、有主线/武功落点、有 ≥4 房的可玩闭环。**判定标准：≥4 房 且 至少 1 个 NPC 或 1 条剧情落点。**

---

## 6. 房间级迁移清单（工程照着改）

> 每条格式：`原 room id → 处理 → 目标 region / 新 id / 新名 → 理由`。
> **新 id 一律不用 `hm_` 前缀**（避开 map-check 断言 5 的 owner 校验 & 断言 8 的"住宅不连片"，与现有 `jn_home_*` 同类）。

### 6.1 删除（29 条，全在 `jiangnan`）

| 原 id | 原名字 | 理由 |
|---|---|---|
| `jn_home_02` `jn_home_03` … `jn_home_30` | 李宅 / 王宅 / … / 城西·郑家 | 纯填充宅院，**零外部引用**（无 NPC、无 quest、无代码引用）；其中 24 座迁建、5 座直接拆 |

> ⚠️ 删除后必须同步清理以下**悬空出口**（否则 map-check 断言 2 报"目标不存在"）：
> - `jn_resident_1`：删去 `s→jn_home_04`、`ne→jn_home_07`、`nw→jn_home_10`、`se→jn_home_13`、`sw→jn_home_16`（**保 `n→jn_home_01`**）
> - `jn_resident_2`：删去 `n→jn_home_02`、`e→jn_home_05`、`ne→jn_home_08`、`nw→jn_home_11`、`se→jn_home_14`、`sw→jn_home_17`（**保 `w→jn_resident_1`、`s→jn_resident_3`**）
> - `jn_resident_3`：删去 `e→jn_home_03`、`w→jn_home_06`、`ne→jn_home_09`、`nw→jn_home_12`、`se→jn_home_15`、`sw→jn_home_18`（**保 `n→jn_resident_2`、`s→jiangnan_street`**）
> - `jn_home_01`：删去 `n→jn_rich_hall`（这是一条**既有的非对称边**，见 §7.1）

### 6.2 迁建新建（24 条）+ 6.3 配套巷（6 条）

| 江南原 id | 目标 region | 新 id | 新名字 | 迁入后挂靠（入口房） |
|---|---|---|---|---|
| `jn_home_03` | `luoyang` | `ly_home_01` | 洛阳·王宅 | `luoyang_mudan_lane` 洛阳城·牡丹巷 |
| `jn_home_02` | `luoyang` | `ly_home_02` | 洛阳·李宅 | 同上 |
| `jn_home_14` | `luoyang` | `ly_home_03` | 洛阳·沈宅 | 同上 |
| `jn_home_15` | `luoyang` | `ly_home_04` | 洛阳·韩宅 | 同上 |
| `jn_home_08` | `changan` | `ca_home_01` | 长安·郑宅 | `changan_huanguan_lane` 长安城·宦宅巷 |
| `jn_home_10` | `changan` | `ca_home_02` | 长安·陈宅 | 同上 |
| `jn_home_18` | `changan` | `ca_home_03` | 长安·秦宅 | 同上 |
| `jn_home_12` | `changan` | `ca_home_04` | 长安·卫宅 | 同上 |
| `jn_home_16` | `chengdu` | `cd_home_01` | 成都·杨宅 | `chengdu_jinli_lane` 成都府·锦里宅巷 |
| `jn_home_17` | `chengdu` | `cd_home_02` | 成都·朱宅 | 同上 |
| `jn_home_20` | `chengdu` | `cd_home_03` | 成都·许宅 | 同上 |
| `jn_home_06` | `xiangyang` | `xy_home_01` | 襄阳·周宅 | `xiangyang_jiangmen_lane` 襄阳城·将门巷 |
| `jn_home_07` | `xiangyang` | `xy_home_02` | 襄阳·吴宅 | 同上 |
| `jn_home_09` | `xiangyang` | `xy_home_03` | 襄阳·冯宅 | 同上 |
| `jn_home_11` | `harbor` | `hb_home_01` | 码头·褚宅 | `jn_harbor_backstreet` 江口码头·货栈后街 |
| `jn_home_19` | `harbor` | `hb_home_02` | 码头·尤宅 | 同上 |
| `jn_home_21` | `harbor` | `hb_home_03` | 码头·陈宅 | 同上 |
| `jn_home_24` | `harbor` | `hb_home_04` | 码头·黄宅 | 同上 |
| `jn_home_22` | `gusu` | `gs_home_01` | 姑苏·**慕容别院** | `gusu_zhai_lane` 姑苏·世家巷 |
| `jn_home_23` | `gusu` | `gs_home_02` | 姑苏·刘家院 | 同上 |
| `jn_home_25` | `gusu` | `gs_home_03` | 姑苏·赵家小院 | 同上 |
| `jn_home_26` | `yamen` | `ya_home_01` | 衙后·孙宅 | 挂 `jn_yamen_back`（后衙，无需新巷） |
| `jn_home_13` | `yamen` | `ya_home_02` | 衙后·蒋宅 | 同上 |
| `jn_home_05` | `yamen` | `ya_home_03` | 衙后·孙家院 | 同上 |
| — | `luoyang` | `luoyang_mudan_lane` | 洛阳城·牡丹巷 | 新巷，`luoyang_street` 北 |
| — | `changan` | `changan_huanguan_lane` | 长安城·宦宅巷 | 新巷，`changan_street` 西 |
| — | `chengdu` | `chengdu_jinli_lane` | 成都府·锦里宅巷 | 新巷，`chengdu_street` 东 |
| — | `xiangyang` | `xiangyang_jiangmen_lane` | 襄阳城·将门巷 | 新巷，`xiangyang_street` 西 |
| — | `harbor` | `jn_harbor_backstreet` | 江口码头·货栈后街 | 新巷，`jn_harbor_shed` 南 |
| — | `gusu` | `gusu_zhai_lane` | 姑苏·世家巷 | 新巷，`gusu_yanzi` 东 |

### 6.4 补建（20 条 · 填空壳 / 后山 / 舞台）

| 目标 region | 新 id | 新名字 | 理由 |
|---|---|---|---|
| `shaolin` | `shaolin_houshan` | 少林·后山 | 藏经阁剧情延伸 |
| `emei` | `emei_houshan` | 峨眉·后山 | 补足门派纵深 |
| `wudang` | `wudang_houshan` | 武当·后山 | 补足门派纵深 |
| `dali` | `dali_wuhua` | 大理·五华楼 | 段氏王府外的市景 |
| `miaojiang` | `miaojiang_zhai` | 苗疆·苗寨 | 落地"万山红雾，蛊虫满寨" |
| `xiyu` | `xiyu_shule` | 西域·疏勒镇 | 第三幕商道舞台 |
| `haitan` | `haitan_village` | 梅海滩·渔村 | 去掉 3 房空壳 |
| `beijiang` | `beijiang_shankou` | 雪谷·山口 | 第三幕前哨卡① |
| `beijiang` | `beijiang_houzhai` | 血刀寨·后寨 | 第三幕前哨卡② |
| `xixia` | `xixia_yanchang` | 西夏·盐场 | 落地"煮盐的人比打仗的人多" |
| `xiake` | `xiake_dong` | 侠客岛·石室 | 秘境核心 |
| `xiake` | `xiake_dukou` | 侠客岛·渡口 | 秘境入口 |
| `jinguo` | `jinguo_shi` | 旧陵·石室 | 机关层 |
| `jinguo` | `jinguo_tomb` | 旧陵·主墓 | 宝藏层 |
| `many` | `many_pool` | 蛮荒·毒沼 | 秘境第一拍 |
| `many` | `many_camp` | 蛮荒·野人寨 | 秘境第二拍 |
| `many` | `many_ruin` | 蛮荒·上古遗迹 | 秘境第三拍（奖励） |
| `secret` | `secret_guishi` | 黑市·鬼市 | 禁区第一拍 |
| `secret` | `secret_anxiang` | 黑市·暗巷 | 禁区第二拍 |
| `secret` | `secret_cage` | 黑市·囚笼 | 禁区第三拍（呼应掳人 #111） |

### 6.5 建议顺手清理（可选，1 条）

| 房间 | 处理 | 理由 |
|---|---|---|
| `test_room`（测试房间，region=`wild`） | **删**（在非 `50_map.json` 的层） | 开发遗留房，且它把出口挂到 `jiangnan_street`，属噪声 |

---

## 7. 铁律与工程约束（**必须写进实现，别踩**）

### 7.1 出口反向边必须"严格一致"

- 规则：**`A` 在方向 `d` 通到 `B` ⟺ `B` 在反向 `opp(d)` 通回 `A`**。
- 现状隐患：**全图现存 57 处严格非对称边**（例：`jn_home_01 -n-> jn_rich_hall`，但 `jn_rich_hall -s-> jn_rich_house`；`palace_hall -n-> palace_garden`，但 `palace_garden -s-> palace_court5`）。
- ⚠️ **`tools/map-check.js` 断言 2 只检查"反向方向键是否存在"，不检查"是否指回同一房"**——所以这 57 处现在是**绿的**，但地图上实际有单向门/死房。**这是本次最阴的坑，见 §8 R5。**
- 要求：迁移后跑一次**严格审计**（`A.d→B ⇒ B.opp→A`），逐条补边；建议同时把 map-check 断言 2 收紧为 `back[opp] === id`。

### 7.2 region 定义：34 个，一个不增不减

- `map-check.js:83` 硬编码 `ok(ids.length === 34)`。**不得新增/删除 region**；`minW/minH` 可按新房间数调整，但 `name/color/tier/province/desc/entry` 必须齐（断言 3）。
- 每个 region 的 `entry` 必须是真实房间（断言 3），`distinct` 必须被 NPC 的 `district` 引用到（断言 4）。

### 7.3 `private:true` 是被占用的既有语义，别一刀切

- `private` 目前用于：**estate 家园 / home 主宅 / sectFounder 宗门**——表示"玩家房产不上地图"。
- **删房间只能认自己的标记**（本次只删 `jn_home_02..30`），**不能按 `private` 过滤**。
- 新建的 24 座宅（`*_home_*`）**不要**打 `private`（它们是地图上的实体民宅）。

### 7.4 `hm_*` 只剩 24 个，**不许动**

- 全图 24 个 `hm_*`，全部是 `design/09 §3.2` 点名保留的 A/B 层显要人物之家（岳不群/令狐冲/方证/冲虚/灭绝/洪七公/东方不败/黄药师/蓝凤凰/段誉/血刀老祖/丁春秋/药婆婆 + 12 个升级 B 层），**零孤儿**，与 NPC 的 `home` 一一对应。
- 断言 5（owner 真实存在）+ 断言 8（住宅不连片/不跨区/不挂他人常驻房）都盯着它们。**本次迁移一个都别碰。**

### 7.5 285 个 NPC 的 `home` 是虚拟私宅，别当实体房

- 实测：**333 个 NPC 中，285 个 `home = "house:<npcId>"`**（虚拟私宅，#111 拜访机制已落地），**24 个** `home = "hm_*"`（实体私宅），**24 个** 无 `home`。
- 虚拟私宅**不占 room id**，删实体房时**不要把 `house:*` 误当房间处理**（断言 5 会校验 `house:<id>` 必须等于自己的 id）。

### 7.6 `terrain` 装饰层已接线

- `maplayout.js` 的 `packRegions` 认 `terrain`，会**跳过压房格**（压到房间的装饰格被丢弃 → 该区填充率下降）。
- 新增房间后，**必须重算各 region 的 terrain**，使 `fill ∈ FILLED[tier]` 区间、`box ∈ [6,22]`、`spec.minW ≤ box.w+1`（断言 6/7）。用 `tools/gen-terrain.js` 按新 room 集重跑。

---

## 8. 风险清单（每条附缓解）

| # | 风险 | 可能打破的东西 | 缓解 |
|---|---|---|---|
| **R1** | **误删主线/支线依赖房** | `jiangnan_market`(21 NPC+9 quest)、`jiangnan_inn`(21 NPC+8 quest)、`jiangnan_temple`(17 NPC+6 quest)、`jiangnan_gate`(6 NPC+3 quest)… | 本次**只删 `jn_home_02..30`**（脚本证实对外零引用）；其余江南房间**一间不动**。删前逐条 grep 复核 |
| **R2** | **出生点/教程断裂** | `00_core.json` 的 `meta.startRoom = road_jiangnan_1`；`tutorial.js`；`smoke-b9-intro.js` 断言 `startRoom === 'road_jiangnan_1'` | `road_jiangnan_1` **id 与出口 `n/s/w/e` 一律不动**；江南改造不删任何 `road_*` |
| **R3** | **NPC 的 `room`/`home`/`district` 悬空** | 41 个 NPC 站在江南房间；`hm_*` owner；`house:<id>` 自洽 | 不删任何"有 NPC 站立"的房间；新宅不用 `hm_` 前缀；不动 `district`（region 未增删） |
| **R4** | **生成脚本回流覆盖手改** | `tools/gen-map.js`（会重造 `jn_home_*`）、`gen-homes.js`、`gen-fix-npcs.js`、`patch-guard-gates.js`（曾给 `jn_home_09` 加过宫内暗道） | 落地后**同步更新或停用**这些脚本；CI 里加"重跑 gen 后 diff 应为空"的守卫 |
| **R5** | **严格反向边造假绿（最致命）** | 现 57 处非对称；map-check 断言 2 只查"反向方向键存在"，**不查指回同一房** → 单向门/死房可长期绿着 | 迁移后跑**严格审计**并补边；**顺手把断言 2 收紧为 `back[opp]===id`**；新增/迁建房的每个出口都配真反向边 |
| **R6** | **删房后出口悬空** | `jn_resident_1/2/3` 指向被删 `jn_home_*` 的出口 | 按 §6.1 清单**同步删出口**；删完重跑 map-check 断言 2 |
| **R7** | **地图渲染断言（填充率/边长）** | 断言 6（terrain 越界/压房/总数>200）、断言 7（fill 区间、box∈[6,22]、minW≤box+1）、断言 6 的"地图接近方形 ratio≥0.6" | 改房数后**重算 terrain 与 minW/minH**（§7.6）；重跑 `map-check` 直到 8 条全绿（现 `6278 通过 / 0 失败`为基线） |
| **R8** | **`terrain` 压房导致填充率下跌** | `packRegions` 丢弃压房格 → `used` 变小 → 断言 7 可能跌破下限 | 用 `gen-terrain.js` 按新 room 集重算；保证每区 `terrain` 落地数足够 |
| **R9** | **命名/归属不一致（已存在，非本次引入）** | `wild` 区里有 8 个"城西"`jn_*` 房；`jiangnan` 区里有 `palace_street`（皇城御街）；`market.jm_underground` 与 `secret.secret_black_market` 两个"黑市" | **本轮只登记不改**（改连通风险高，留 B13-续）；`palace_street` 已被 `smoke-guards.js` 断言锁死，**不得移动** |
| **R10** | **存档兼容** | 玩家存档若停在被删房间 / 旧 id → 读档崩 | 加**旧 id → 新 id 迁移表**（或读到失效房时回退到 `road_jiangnan_1`）；`reviveInstances` 兜底 |
| **R11** | **测试/工具硬编码房间 id** | `world.js` 的 `PLAY_ROOMS` 含 `jn_resident_1`；`smoke-b9-intro.js`/`smoke-guards.js`/`docdata.js` 引用江南房 | 保留 `jn_resident_1` 等被引用房；改后跑**全量 28 套 smoke** 复核 |
| **R12** | **总数上浮需主人确认** | 291→312（+7.2%） | 已在 §0.1 给账；若主人坚持持平，则砍"补建"数量（`many`/`secret`/`jinguo`/`xiake` 各降到 3） |

**最致命的一条：R5（严格反向边"假绿"）。** 它和其他风险不同——**不报错、不红了，但地图上真有一条条走不回去的单向门**。工程若只信 `map-check` 的绿灯，会把 57 条老病 + 新迁房的新病一起带进正式版。**必须在迁移同时收紧断言 2 并跑严格审计。**

---

## 9. 执行顺序与验收

| 步 | 做什么 | 产出 | 验收 |
|---|---|---|---|
| 1 | 备份 `50_map.json`；建"旧 id→新 id"迁移表 | 备份 + 映射表 | 可回滚 |
| 2 | 删 `jn_home_02..30` + 清 `jn_resident_1/2/3`、`jn_home_01` 的悬空出口 | `50_map.json` | 断言 2 绿；无 dangling |
| 3 | 建 6 条宅巷 + 24 座新宅，挂对入口房 | `50_map.json` | 断言 2 绿（严格） |
| 4 | 建 20 间补建房（后山/秘境/舞台） | `50_map.json` | 断言 1/2 绿 |
| 5 | 重算各 region `terrain` + 调 `minW/minH` | `50_map.json` | 断言 3/6/7 绿 |
| 6 | 删 `test_room`（非 50_map 层） | 数据 | 引擎合并后无该房 |
| 7 | **收紧断言 2 为严格反向** + 跑严格审计 | `tools/map-check.js` | 全图非对称边 = 0 |
| 8 | 全量回归 28 套 smoke + map-check | 测试 | 全绿；`map-check` 6278+ 项通过 |
| 9 | 回填 `12-owner-bug-list.md` B13 状态 | 文档 | 标记已改 |

**DoD**：① `50_map.json` 房间数 = 312、region 数 = 34；② 严格反向边非对称 = 0；③ map-check 八条全绿；④ 28 套 smoke 全绿；⑤ 江南 27 间、主脉络零删；⑥ 文档回填。

---

## 附：本文用到的实测命令（可复现）

```js
// 房间/区域总览（50_map.json 口径 = map-check 口径）
const {GameEngine}=require('./game/src/core/engine');
const e=new GameEngine({seed:20261010}); e.boot();
const w=e.world;                       // w.data.rooms / w.data.regions
// 注意：map-check 读的是 game/data/50_map.json（291 房/34 区），
//       引擎合并后多出 demo 的 tingyu 4 房 + test_room 1 房 = 296/35。
```

- 反向边严格审计：遍历 `rooms[id].exits`，校验 `rooms[to].exits[OPP[d]] === id`（现存 57 处不满足）。
- 富户判定：`/宅|府|院|庄$/` 命中 62 间，其中 `jiangnan` 32 间（31 富户 + `hm_npcv_027`）。

*本文只出方案。落地改动（数据 + 代码 + 测试）由工程执行，任何 `game/data/*.json` 的写入前请经主人拍板。*
