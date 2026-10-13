# 94 · P5 前置只读盘点单（亥时山门 / 思过崖 T-D / 旧道隐藏边）

> 只读盘点，不动 data。2026-10-13。口径：引擎合并视图 + 源码核对。

## 一、重大发现：exits cond 引擎已全量支持，P4 §五c 立项应撤销

`commands.js` doMove（约 443–455 行）**现成支持**：

- `exits.dir = { to, cond, say, travel, msg, cost }` 完整链路：cond 不过 → `ex.say`（站在门前的人说话，sectRefusal 范式）→ 无 say 退回 `ex.msg`；
- cond 走 `evalCond` 全量能力（**flag / notFlag / item / and / or / not / flagsAll / attr / 数值比较**全都在）；
- `ex.travel` = 通过那一刻的场景行；
- 源码注释里已经写着「卷界拦截（design/89 §七·d 铁律 1/3）」——这能力就是按 89 建的。

**影响三处**：

1. **P4 独木桥门槛**：dumuqiao 的 n 出口直接加 `cond:{flag:'act1_bridge_crossed'}` + `say`（74 味一句），**不需要寇豆码任何改动**。请撤销/暂停该立项（若已排）。
2. **P5 旧道隐藏边**：数据侧直接落，同上。
3. **design/93 五道卷界文案**：字段落位现成——不通航台词 → `ex.say`，通航场景 → `ex.travel`（或一次性 action），拒飞一句 → flight 层文案照 71 §二范式。S1 拿 93 号直接落数据。

存量用例可证：huashan_shanxia n 出口已是 `{cond:{item:'huashan_pass',count:1}, msg, travel}` 三件套在跑（行 1074）。

## 二、亥时山门（huashan_shanxia + guard_huashan）现状

- guard_huashan「华山弟子」在岗 huashan_shanxia，talk 5 句（登记/竹牌/碑），gender male，无 schedule。
- 「登记」action 已落：narrate + +item huashan_pass + say，配套 n 出口 item cond 拦截——**74 山门戏的「登记拿牌」骨架已在**。
- **缺口 1（时辰门）**：74「天黑不进人，明早卯时能进」需要按时间判出口——`evalCond` **无时间/时辰字段**（modapi 无 hour/clock 条件），引擎侧不可判。降级建议：act1 时序本由主线推进，**不做时辰门**，山门夜的戏文本压在思过崖认痕前置（63 片已落）——验收点「拿到明天要做的事」已覆盖。
- **缺口 2（场景行）**：74 的「石阶一百二十七级/被面补过两回补丁是两种蓝/山门房睡一夜」未落。P5 落 huashan_shanxia desc 补石阶段 + 新开山门房或并入 shanxia 一段「山门房」narrate（建议后者，不加房、控 B2）。
- guard_huashan talk 与 74 值守弟子台词（「天黑不进人/卯时到申时能进/外乡人先去思过崖」）未对齐——P5 把 74 三句并进其 talk 槽（守卫台词口径，N1/N2 自查后落）。

## 三、思过崖 T-D 现状与状态机裁决

- 63_mainline_act1 已落：huashan_siguoya「认痕」action（cond act1_letter_taken / notFlag act1_recognized / once，三段 narrate + flag），文本含「第二十一道，收着劲收尾」与值守弟子收尾句。
- 88 施工单要求「T-D 手动件状态机」——核对 74 原文：T-D 是一夜一断（待一夜→天亮认出），**单 action 已覆盖，无需状态机**。建议 88 号 T-D 预估按「已落」销账。
- 可选项（非必做）：74「认不出来，就下山」的失败分支可照 82 新口径加莽撞入口「指认」（cond 同、failMsg 下山一句）——**建议砍**：认痕夜的重量在「一夜不说话」，加分支反而稀释；留 74 文本原样。
- 地形：huashan_qingke w→siguoya（西邻已接，双向回 e 已有）、siguoya n→houdong（后洞 s 回，闭合）。P5 无需动图。

## 四、分支甲旧道隐藏边：两端房核实与方案

74 原意：旧道从山后绕过去，绕的就是涧/独木桥。现状链路 `cunzhen_gate --nw--> dumuqiao --n--> shanjiao_inn`。

**两端 = cunzhen_gate 与 shanjiao_inn**。方案（P5 落库用）：

- 新建 1 隐藏房 `oldroad`（华山旧道，private:true 不进地图视图/map-fog 不计）；
- cunzhen_gate 加出口（建议 w）：`{to:'oldroad', cond:{flag:'act1_oldroad_seen'}, say:<74 文本「道旁有三处塌方…」节选>, travel:<垫石两寸高差段>}`；
- oldroom 反向 e→cunzhen_gate（无 cond，回来的路自然认得）；oldroad n→shanjiao_inn（无 cond，走到头就是山脚）；
- shanjiao_inn 加 s→oldroad **同 cond act1_oldroad_seen**——map-edge 反向一致性要求双向，且没见过细线的人从山脚也找不到道口，两边同 cond 最干净。
- ⚠️ **线性化方向对表（需你裁）**：design/90 地图线性化细化进行中，旧道本质是跳过独木桥的捷径。74 把它定为甲分支奖励（省五里路），但若线性化要求 act1 主干强制走独木桥，两者相抵。建议：保留旧道但确认它在 act1 不是必经（现独木桥门槛若 P4 补了 flag cond，甲玩家走旧道同样能过山——两条路都通 T-C 验收）。落库前等你跟线性化方向对一次。

## 五、风险单汇总

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| 1 | P4 §五c exits cond 立项已无必要，若寇豆码已动工会撞存量实现 | 高 | **立即撤项**（引擎已支持，见 §一） |
| 2 | 旧道捷径 vs 线性化方向相抵 | 中 | §四末条，等你与 design/90 对表后定 |
| 3 | 时辰门引擎不可判（无时间 cond 字段） | 低 | 降级方案 §二，不动引擎 |
| 4 | 旧道房 private 后 map-fog/region-filter 口径 | 低 | WORLD_ROOMS 谓词已动态（−private），加房自动豁免，实测确认即可 |
| 5 | guard_huashan talk 改动触发 persona/TONE_KW 反查 | 低 | P5 落库时按 TONE_KW 选词（他现 talk 是硬朗短句，向 haoshuang/zhengjie 靠） |

## 六、P5 落库量预估（grep -o）

旧道房 1 + 边 4 处（cunzhen_gate/shanjiao_inn 各 1 出口改、oldroad 2 出口）+ guard_huashan talk 并 3 句 + 山门场景行 2 段 + 认痕销账 0 ≈ **~10 处**（88 预估 40 处——认痕已在 63 片落掉，独木桥门槛挪 P4）。

## 七、team-lead 四裁决（2026-10-13，全批）

1. exits cond 撤单已发寇豆码；「派单前先核存量（grep 引擎再派单）」记入流程。
2. 93 号卷界文案过审，转 S1。
3. 旧道与线性化**不相抵，批**——旧道是分支甲叙事奖励（不跨卷界，符合 90「卷内自由」）。落库时「两端 cond act1_oldroad_seen + private 房」写成**断言钉死**（map-edge/新守卫层：无 flag 时此路对玩家不可见不可走）。
4. T-D 指认失败分支**砍**（88 号 T-D 销账）；时辰门**不做**（evalCond 无时间字段，不硬造）。

P4/P5 落库均等窗口关闭口令（寇豆码 view 瘦身收口）。
