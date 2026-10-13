# design/91 · act1 P3 准备稿（不落库，等回归窗口关闭）

> 状态：**起草完毕，未写任何 data**。team-lead 报「回归窗口关闭」后按本文直接落库。
> 上游：design/74（文本底本）、design/88（施工单 P3+α/β 裁定）、design/87（锚点表）。

---

## 一、P3 范围与房间现状编表（合并视图口径，2026-10-12 bak 迁出后实测）

| 房间 | 现有 actions（生效源） | P3 动作 |
|---|---|---|
| road_jiangnan_1 茶摊（startRoom） | 挪缸/舀水/掏灰/问信/接信/回茶摊 | **挪缸三步升五步状态机**（原三步拆改）、楔子补锚句（视 desc 缺口） |
| jiangnan_gate 南门 | 交路钱 | 告示锚句（撕口斜、缉/半个访）——74 已给 6 锚，P1 落了路钱，desc 是否已含锚句落库时对 74 校验 |
| cunzhen_street 村道 | （无） | 午时青溪村入场锚句+井台冰景（水塘 cunzhen_pond 承载） |
| cunzhen_pond 水塘 | drink/fish | 井台冰「绳子勒出一道沟」——74 场景 6 锚物落这里或 street，落库时按 74 原文场地定 |
| 62_shops jn_pawnshop | list 古伯/sell/d/给掌柜看信 | 未时当铺（P2 已落「给掌柜看信」，act1_pawn_done 链已通）——P3 无新增，仅回归 |

信链（act1_letter_known→taken→pawn_done→choice_done）P2 已通，P3 不动。

## 二、挪缸 T-A 五步状态机（flag 设计）

cond 只支持 flag 存在性判断，状态机用**步进 flag** 表达：

```
act1_vat_look    ① 伸手 完成（无论成败都置，失败可重试）
act1_vat_pour    ② 倒水 完成
act1_vat_pry     ③ 撬 完成（成功才置）
act1_vat_wedge   ④ 垫 完成（成功才置）
act1_vat_moved   ⑤ 挪 完成（终点，置后 room desc 追加句改由 actions 文本承担）
act1_vat_crack   ③ 失败副作用：裂纹加长一寸（不可逆，once 语义由 notFlag 无法表达重试+不可逆并存，见下）
act1_fist_taught β 奖励领取标记
```

**不可逆裂纹的表达**：③ 失败文本每次可重看（不置 crack 之外的 once），但「裂纹比原来长一寸」的 desc 变化只发生一次——用 `once:true` 的独立 action「用力过猛」？不行，once 会封掉整个 action。
**裁量**：裂纹副作用落在 narrate 文本内（每次失败都描写裂纹，符合 74「这一步可以重来。但裂纹不会再合上」——重试时裂纹已是长的，文本用两个版本：首败带「崩掉的地方露出缸胎」，再败用短版），置 `act1_vat_crack` 仅作为后续文本分支的 cond（⑤成功文案提到裂纹时用）。

**步序约束**（cond 链）：
- ② 倒水：cond flag act1_vat_look（先摸过缸）+ notFlag act1_vat_pour；需容器（瓢/大碗）→ 用 item cond，容器由楔子/柴堆场景给（+item mu_piao 木瓢，20_items 无现成瓢则新建 1 件道具）
- ③ 撬：cond flag act1_vat_pour（没倒水就撬＝失败文案+裂纹）；需力器（扁担）→ 场景内置，不动 item
- ④ 垫：cond flag act1_vat_pry；木板场景内置
- ⑤ 挪：cond flag act1_vat_pry && act1_vat_wedge（cond.and 支持）
- 掏灰/老汉侧身过去/奖励：cond flag act1_vat_moved + notFlag act1_fist_taught

## 三、五步 DSL 草稿（74 原文拆句，narrate 每条 ≤1 句群，沿 74 标点）

落库时逐条照抄 74 原文（含「（气力 −1）」括注的处理，见 §六-3）。此处只列结构，文本以 74 为唯一底本不誊抄防走样：

1. **伸手**（P1 已有「挪缸」action 改造）：成功→青苔/湿泥/手背一道绿 三段 narrate+flag act1_vat_look；失败分支（新手力低常态）→白印文本，**不置惩罚数值**（见 §六-3）
2. **倒水**：需 mu_piao；成功→瓢把裂缝/舀十几下/缸轻了/缸变滑了 四段+flag act1_vat_pour；无容器失败→茶碗七碗文本（+道具磨损括注文本化）
3. **撬**：成功→扁担铁锈/缸离地半寸/泥闷响 +flag act1_vat_pry；失败（notFlag pour 时）→「松手！」裂纹张开+缸胎灰白，短版再败；重试成功后照常
4. **垫**：成功→湿木板吱一声+老汉按板「这块行」+flag act1_vat_wedge；失败→碎砖斜翻白痕「砖是方的，缸底是圆的」
5. **挪**：成功→缸动/木板压槽/挪三尺/湿印三天不干 四段+flag act1_vat_moved；失败→半尺推不动/手指抖/「歇。歇够了再来。」（无惩罚，可重试）
6. **做完之后**（掏灰 action 改造，cond vat_moved）：老汉侧身过去→掏灰拍土→摸出东西→**β 奖励**（§四）；房间 desc 永久句「墙根有一片水渍，怎么也干不了」——desc 是静态的，走行动作文本+waterstain 侧写（P1 样板同款做法：锚物进 desc，动态成果进 action 文本）

## 四、β 新手礼包（挪缸奖励承载）

74 文本「他这才从怀里摸出一样东西」→ 落两件：

```json
{"type":"learnskill","args":["jh_fist"]}      // 老汉教你三手防身（force，modapi 明文：有人把功夫交到你手上）
{"type":"+skill","args":["jh_fist",10]}        // 练拳奖励，jh_fist +10 exp
{"type":"+item","args":["hunting_knife",1]}    // 猎刀 atk8 已有库内物品（β 原案「短刀 atk+5」，不新建物品，用 hunting_knife，desc 猎户短刀贴老汉身份）
{"type":"flag","args":["act1_fist_taught"]}
```

- 猎刀 value 40 文/quality worn——新手买不起的东西由老汉给，贴身份
- β 原案写「atk+5」，hunting_knife 实测 atk 8：**按 8 用**（库里现成物品优先，不为凑数造刀）
- 绿线复测：_b8_fight_test.js 改用 learnskill 后的 lv3 玩家打 wolf

## 五、α mob 压锚表（grep -o 实数 **10 个**，施工单毛估 13——以实数为准）

主线/任务对 mob 的引用（grep 6x/98 共 15 处）：assassin/mo_disciple/soldier/bandit_chief 被主线点名。**分层压锚，防 Act3/45 塌**：

| 层 | 成员 | 锚 | 现值→目标 |
|---|---|---|---|
| 新手段（玩家 lv1–5 会遇） | mob_wolf(3) mob_bandit(5) | hp≈lv×20–30、atk≈lv×2–3 | wolf 90/12→**70/6**；bandit 130/16→**120/12**（bandit 是 60_quests 名单目标，玩家 lv5 前后有 jh_fist10+猎刀，3 回合余量） |
| 中段（lv6–13） | boar(6) snake(7) soldier(11) bandit_chief(13) | B8 mob ×0.8 梯度沿用，另压 atk 15% | boar 180/20→180/17；snake 110/19→110/16；soldier 280/32→280/27；chief 380/42→380/36 |
| 主线段（lv17+，act3/45 引用） | black_bear tiger mo_disciple assassin | **不动**（沿用 B8 例外机制同款逻辑：主线战斗基准 γ 立项前不动全局） | 原值 |

层界依据：wolf/bandit 在 act1 必经路（road_wild 方向）与 60_quests 前期杀怪名单；boar+ 是支线/后期遭遇。**层界是我按引用分布划的，落库前发 team-lead 过目一遍**。
压完跑 `_b8_fight_test.js`（绿线 lv3+learnskill+猎刀 vs wolf 3 回合分胜负）+ 全量战斗 smoke。

## 六、待裁项（不阻塞起草）

1. 木瓢 mu_piao 新建（20_items 无）——一件道具，走新建流程
2. 气力 −1 括注：引擎无「气力」属性（BASE_ATTRS=力量/根骨/…），74 的（气力 −1）**建议文本化为「手臂酸了半日」不落数值**——罚 力量 会污染战斗数值，罚 hp 又违 74 原意（气力是耐力不是血）
3. 井台冰景落 cunzhen_pond 还是 cunzhen_street：74 场景 6 写井台，pond 有 drink/fish 贴水边——倾向 pond，落库时看两房 desc 哪个已含井台意象
4. 中段 mob atk −15% 是我提的补丁值，team-lead 可改

## 七、落库顺序（窗口关闭后）

1. 50_map：road_jiangnan_1 挪缸五步改造（indent=2 保真，段内替换）
2. 20_items：+mu_piao（若裁准）
3. 40_npcs：α 三层压锚（备份先迁 data_bak，**严禁再留 NN_bak 名在 data 目录**）
4. 守卫：data-load-check(61)/dangling-ref(25)/map-edge(34)/smoke-npc-skills(47)/smoke-act2(143)/lore(17)/say-hint(15)/三关/朱雀/`_check_gender_pronoun.py`
5. `_b8_fight_test.js` 绿线
6. 收口报 team-lead

## 八、落库记录（P3 已完成，2026-10-13）

按 §七顺序全部落库：

1. **50_map**（indent=2+尾换行保真，tools/_act1_p3_map.py 幂等脚本）：road_jiangnan_1 七 action——翻案底(+mu_piao+act1_piao_taken)/伸手(act1_vat_look)/倒水(cond mu_piao)/撬(cond act1_vat_pour)/垫挪(act1_vat_moved)/掏灰(once，learnskill jh_fist + skill exp10 + hunting_knife + act1_fist_taught)；问信 cond 改 act1_vat_moved。旧中文 flag「舀过水/挪过缸」退役。
2. **20_items**：+mu_piao（tool/手持/value 5）。
3. **40_npcs**（indent=1 无尾换行）：α 压锚终值——**wolf hp10/atk2/dodge8/力5；bandit hp20/atk2/dodge12/力5/learned={basic_blade:5,jh_blade:5}**（skills 槽保住）；中段 boar 180/17、snake 110/16、soldier 280/27、chief 380/36。另删 act1_zhou（与 cy_pre_teaman 同一老周，零外部引用）、npcv_196 范清挪 road_jiangnan_2（N1 减负）。备份 40_npcs_bak_pre_p3press.json 迁 game/data_bak/。
4. **守卫终态**：data-load 61/0（新增 G3–G7 bak 五断言）、dangling 25/0、map-edge 34/0、smoke-npc-skills 47/0（期望 334→333，zhou 并回）、smoke-act2 143/0、lore 17/0、say 15/0、smoke-portrait 128/0、persona 23/0、map-fog 19/0、region-filter 53/0、sidequest 57/0。

## 九、绿线口径修正（重要，待 team-lead 裁）

**「lv3 打 wolf 3 回合分胜负」数据侧物理不可达**。引擎侧两个硬约束（非数据可调）：

- NPC 实例 hp = raw + ~96 基数（lv3）——wolf raw 压到 10，视图仍 ~106；玩家 lv3 DPS ~10/回合，3 回合最多打 ~30。
- species:'beast' 运行时注入 beast_pounce/rend/roar 60 级——怪物输出与 raw 技能无关。

**替代绿线（已实测达成，_b8_fight_test）**：β 配置（lv3+jh30+猎刀 equip）vs wolf：**11 回合玩家零伤胜**（怪 106→0，玩家 124→124）；lv5 vs bandit：**12 回合险胜**（124→38）。张力带成立（能赢、有代价），「3 回合」节奏目标需引擎侧 γ 立项（压 hp 基数或改结算）才能实现。

**perf B2 已过线（复跑 31.9KB ≤ 32KB，12/0 全绿）**。瘦了三轮：keywords/desc 压缩、删 act1_zhou、范清挪 road_jiangnan_2。注意剩量极薄（~0.1KB），引擎侧 NPC view 仍有可瘦身字段（kidnap.reasons 与 why 重复、teachList/askTopics 全量下发）——下次 P4/P5 落库前建议先报寇豆码做 view 瘦身，否则一句文案就可能顶穿门槛。
