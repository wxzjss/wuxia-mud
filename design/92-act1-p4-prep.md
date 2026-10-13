# 92 · act1 P4 准备稿（申时分支甲乙 + 酉时独木桥失败分支）

> 底稿：design/74（申时 344–415 行 / 酉时 417–507 行）。本稿只起草，**不落库**——等 team-lead 喊「窗口关闭」（寇豆码 view 瘦身收口）再按 §七落库。
> 现状核对口径：引擎合并视图（GameEngine → world.data），grep -o 计数，2026-10-13。

## 一、现状盘点（已落 vs 缺口）

P3 及之前批次已落：

| 项 | 现状 | 位置 |
|---|---|---|
| 申时选择（告诉他/不说，flag act1_told_truth / act1_kept_silent / act1_choice_done） | ✅ 已落，raw 紧凑式 | 50_map road_jiangnan_1（行 507） |
| 酉时独木桥 T-C 成功线三步（探 act1_bridge_probe / 稳 act1_bridge_steady / 过 act1_bridge_crossed） | ✅ 已落，过桥文本已并「落地」段 | 50_map dumuqiao |
| 戌时口信（带口信→act1_msg_carried / 转交口信→act1_msg_delivered + 布鞋） | ✅ 已落 | 50_map cunzhen_gate + 63_mainline_act1 shanjiao_inn |
| 思过崖认痕（act1_recognized） | ✅ 已落（属 P5 范围但已在 63 片） | 63_mainline_act1 huashan_siguoya |

**P4 缺口（本批起草对象）**：

1. **分支乙「三天后回茶摊」整段缺**——灶凉/信压砖下/站到天黑/「从此没有任何人替你作证」，四段全无。
2. **分支甲后续铺垫缺**——74 甲文本里「地图西南角多出一条细线」一段未落（旧道隐藏边本体归 P5，本批只落叙述段）。
3. **独木桥失败分支全缺**——74 四步各有失败文本（探滑倒/稳掉包袱/过遇驴/+落地伤膝），现状只有成功线。
4. **过桥门槛未挂**——dumuqiao 的 n 出口（→shanjiao_inn）不检查 act1_bridge_crossed，玩家可以不走 T-C 直接出门。见 §五裁决项。

## 二、起草一：分支乙「三天后回茶摊」

**落点**：road_jiangnan_1（茶摊房，存量 actions 生效源在 50_map，**不能写 63 片**——63 片 _note 明示 rooms.X.actions 整组替换）。

- cmd「回茶摊」，keywords:['回','茶摊','老汉']，desc「三天后，你再回到茶摊」
- cond：`{flag:'act1_kept_silent', notFlag:'act1_silent_seen'}`，once:true，failMsg「你回过了。灶是凉的，没有人。」
- effects（narrate ×4 + flag，文本照 74 拆四段，一字不改）：

1. 「芦席还在，四根竹竿还在，断的那根上缠的布条还在。灶是凉的。灶膛里的灰被雨淋过又冻上，结了一层硬壳，壳是灰白的，敲上去有响声。」
2. 「案板上搁着那封信，压在一块碎砖底下。封皮朝上，印朝上。信是干的。压信的那块砖是从灶边取的，砖上还沾着一点灶灰。缺嘴的壶还在，壶里没水。长凳翻过来搁在案上，凳面朝下。」
3. 「你把信拿起来。纸上除了封皮，没有别的字。你在那儿站到天黑。没有人回来。」
4. 「从此没有任何人替你作证。这条路上，你后来遇到过三回需要一个人替你说句话的场合。三回都没有人。」
5. flag `act1_silent_seen`

**设计意图**：这是全 act1 唯一一次「玩家选了乙，游戏用沉默惩罚他」的落点。第四段是旁白越权（直接告诉玩家后果），是有意为之——74 原文如此，扣着不讲的原则在这句上让位给「不可逆选择的重量」。

**旁白出口注意**：failMsg 与旁白不得进提示条（say-hint 15 项照跑）。

## 三、起草二：分支甲后续铺垫

**落点**：road_jiangnan_1，独立小 action（甲玩家第二天动身前的收束）。

- cmd「动身」，keywords:['动身','上路','出发']，desc「第二天早上，收拾东西上路」
- cond：`{flag:'act1_told_truth', notFlag:'act1_oldroad_seen'}`，once:true，failMsg「你已动身。」
- effects（narrate ×2 + flag）：

1. 「第二天早上你起身上路。地图的西南角多出一条细线：一条从山后绕过去的旧道。那条道不在任何一张路引上。道旁有三处塌方，最险的那一处被人垫过，垫得不算平整，但能下脚。」
2. 「垫路的石头是新的，石面上还没有苔。石头摆得有点歪：右脚踩的那块，比左脚那块高出约莫两寸。老汉走路右腿拖。他拖了十九年。你把那两块石头踩了一遍，才继续往前走。」
3. flag `act1_oldroad_seen`

**衔接**：act1_oldroad_seen 同时是 P5 旧道隐藏边（cond: act1_told_truth）的叙事铺垫；P5 落边时把边的 cond 顺手校成 act1_oldroad_seen 更严（见过细线才走得进），本稿建议 P5 采后者。

## 四、起草三：独木桥失败分支

**引擎限制先说清**：evalEffects 的 cond 只支持 flag/notFlag/money/item/and/skill，**没有随机、没有属性/身法判定、没有 ±time**。74 写的「负重>门槛/身法判定失败」在数据侧不可判定。降级方案：**把「判定」变成「玩家的选择」**——成功步（已落的三步）照走，另加一个「急」动作入口，选了急就进失败链。MUD 惯例：莽撞是玩家自己选的，惩罚才有说服力。

### 4.1 探 · 失败（对应 74 ①失败）

- 落点 dumuqiao。cmd「抢过」，keywords:['抢','直接过','不试']，desc「不试了，直接上桥」
- cond：`{notFlag:'act1_bridge_probe'}`（未探过才可抢），once:true，failMsg「你试过了。」
- effects：narrate ×1 + flag `act1_bridge_probe`（抢过也计「探过」——惩罚是摔那一跤，不是回头重探，别双重罚）：

「你一脚踩上去，脚底下一滑。你整个人往前扑，手撑在桥面上，撑住的地方正好是青苔。青苔被你蹭掉一块，露出底下的白木。你退回桥头。两只鞋底全是绿的。」

### 4.2 稳 · 失败（对应 74 ②失败：掉包袱）

- cmd「背东西过」，keywords:['背着','带着','负重']，desc「背着包袱上桥」
- cond：`{flag:'act1_bridge_probe', notFlag:'act1_bridge_steady'}`，once:true，failMsg「你稳过了。」
- effects：narrate ×1 + flag `act1_bridge_steady`：

「你急着过，跨出第一步就晃。晃的时候你伸手去抓，抓了个空。你肩上的包袱滑下来，掉在桥这头。包袱里的东西滚出一件，滚到桥头边上停住。你捡回它，重新蹭了鞋底，看着桥的那一头，一步步走了过来。」

⚠️ **降级说明**：74 原文「掉落一件随身物品，捡回来就得重走两步」——引擎 ±item 需指定物品 id、不能随机选背包，且「重走两步」需要回滚步 flag，数据侧做不到。本稿降级为**纯文本损失感 + 自行重述稳脚**，不加不减物品。74 的验收点是「读过一句关于负重的反馈」，此文本保住该点。真掉落需引擎侧随机选物 effect，挂账 γ 清单。

### 4.3 过 · 失败（对应 74 ③失败：对面来驴）

- cmd「硬闯」，keywords:['闯','不让','硬过']，desc「走到一半不相让」
- cond：`{flag:'act1_bridge_steady', notFlag:'act1_bridge_crossed'}`，once:true，failMsg「你过过了。」
- effects：narrate ×1 + flag `act1_bridge_crossed`（硬闯也计过桥——驴是偶发不是必经，别把玩家锁在涧这边）：

「走到一半，对面来了一头驮货的驴。赶驴的人在后面推，驴不肯退，人也不肯退。你退了。往回走的这七步，比过来的那七步难走。你数着的，一步都没敢看底下。再过桥的时候天已经黑了，青苔在暗里发亮。」

⚠️ **降级说明**：74 原文「时间 +2 时辰」——引擎无 ±time effect，数据侧不可调时钟。降级为文本「天已经黑了」，与 P5 亥时山门「天黑不进人」的时序不冲突（山门戏按时辰钟不走玩家行为）。±time 挂账 γ 清单。

### 4.4 落地 · 失败（对应 74 ④失败：伤膝）

- cmd「跳下去」，keywords:['跳','落地']，desc「从桥上跳下来」
- cond：`{flag:'act1_bridge_crossed', notFlag:'act1_knee_hurt'}`，once:true，failMsg「你落地了。」
- effects：narrate ×1 + flag `act1_knee_hurt`：

「你跳下来的时候踩在一块松动的石头上。石头滚了，你跟着滑了半丈。膝盖磕破了。血渗出来，把裤子上那块补丁浸成深色。你坐着缓了一会儿才站起来。站起来以后走路有点拐。」

**回响落点（74 原文「每次进新房间多一句」引擎不可做，降级为关键房一次性回响）**：

- shanjiao_inn 加小 action「看伤」（cond act1_knee_hurt，notFlag act1_knee_seen，once）：「你把裤腿卷起来看。膝盖肿了一圈，青的。第二天走路会疼。疼痛不扣数值——疼就是疼。」+ flag act1_knee_seen。
- P5 亥时山门房（山门房/被两补丁的被）起草时再带一句「膝盖上的伤绷着，弯不了」收口（P5 范围，先记）。

## 五、过桥门槛（裁决项，不阻塞起草）

dumuqiao 的 n 出口不查 act1_bridge_crossed，玩家可绕过 T-C 直接去山脚。三个选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| a · exits 加 cond | 引擎 exits 支持 cond 则一行 | **需查引擎是否支持 exits cond**（落库前 grep modapi/commands 核，我不动代码） |
| b · 文本引导 | dumuqiao desc 尾加一句「涧对面的事，得过桥才作数」，T-C 靠仪式感不设硬门 | 零风险，但玩家真能绕过（独木桥失去意义） |
| c · 引擎侧出口门 | 报寇豆码：exits 支持 cond（泛化能力，后续隐藏边也用得上，P5 旧道边正需要） | 引擎改动，窗口关闭后一起 |

**我的推荐：c**——P5 分支甲旧道隐藏边（cond flag）本来就要这个能力，一次改动两处受益。等引擎回复前，落库时先带 b 的文本句（不亏）。

## 六、落库量预估（grep -o 口径）

| 项 | 文件 | 预估 |
|---|---|---|
| 乙三天后回茶摊 action | 50_map road_jiangnan_1 | 1 action / narrate×4 / flag×1 |
| 甲动身铺垫 action | 50_map road_jiangnan_1 | 1 action / narrate×2 / flag×1 |
| 独木桥失败链 ×4 | 50_map dumuqiao | 4 actions / narrate×4 / flag×5（probe/steady/crossed 复用+act1_knee_hurt） |
| 看伤回响 action | 50_map shanjiao_inn | 1 action / narrate×1 / flag×1 |
| 合计 | 全在 50_map（indent=2 保真段内替换） | **7 actions / 11 narrate / 8 flag ≈ 26 处**（远低于 88 预估 50 处——戌时口信已随 P2/P3 落掉） |

不新建房、不新建 NPC、不新建 item。flag 新增 4 个：act1_silent_seen / act1_oldroad_seen / act1_knee_hurt / act1_knee_seen，落库后跑 dangling-ref 确认零悬空。

## 七、落库顺序（窗口关闭后）

1. 50_map：dumuqiao 四失败 action（同房集中改，一次 round-trip 保真验证）
2. 50_map：road_jiangnan_1 两 action（乙回茶摊 + 甲动身）
3. 50_map：shanjiao_inn 看伤 action
4. 若裁 c：等寇豆码 exits cond 回复后补门槛/旧道（旧道归 P5）
5. 守卫：data-load-check(61) / dangling-ref(25) / map-edge(34) / lore(17) / say-hint(15) / smoke-act2(143) / `_check_gender_pronoun.py` / perf-step(B2 余量 0.1KB，**本批全在已有房加 action，startRoom 只增 road_jiangnan_1 两 action ~0.6KB，B2 必须复跑**)
6. 收口报数

## 八、风险与可砍项

- **B2 顶穿风险（最高）**：road_jiangnan_1 是 startRoom，加两 action 直接管到 32KB 门槛。缓解：keywords/desc 极简（照 P3 瘦身口径），乙文本用 narrate 不进 desc；仍顶穿则把「甲动身」挪到 cunzhen_gate 侧（动身动作发生在出城方向也成立）——可砍项 1。
- 独木桥失败链 4 个 action 若嫌多，可砍「跳下去」+「看伤」（74 ④失败独立成段但非必经）——可砍项 2，砍后 T-C 三失败仍成立。
- exits cond（§五 c）依赖引擎，若寇豆码排不开，P4 用 b 兜底、c 连同旧道边并进 P5 引擎请求。
- 全部文本照 74 一字不改；三关断言（——/不由得/霎时间/眼底闪过）我起草时已自查为零，落库后守卫复跑为准。
