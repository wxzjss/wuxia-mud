# 《画像钩子 → 真支线》· A 层 26 人（V01–V26）· 共 52 条

> 本文件分三批写成：**第一批 V01–V09（18 条）** · **第二批 V10–V17（16 条）** · **第三批 V18–V26（18 条）**。
> 三批合计 **52 条支线 = 26 位 NPC × 2 hook**，与 `design/portraits-new.json` 的 52 个 `hooks` **一一对应**。

交付人：文策渊（设计+叙事）　任务号：#115　日期：2026-10-11
上游：`design/15-portrait-roster.md`（我写的规范）· `design/portraits-new.json`（26 人 + `hooks`）
主线依据：`design/10-mainline-story.md`（五幕蓝图）· `design/21-mainline-act3-5.md`（三~五幕细写，**细纲已完成；落地方案 E5–E16 截至 2026-10-10 仍基本未做，见 `design/36-md-audit.md`**）
舞台依据：`design/19-map-rebalance.md`（B13 重设计，**已落地**：江南 56→27 房、24 座宅院迁出）

> **本文只出设计。不改代码、不改 `game/data/*.json`、不 commit。** 落地由工程执行。
> **范围**：A 层 26 人（有 `hooks`）中**前 9 人 = V01–V09**（对应 `portraits-new.json` 的 `npcv_241 / 154 / 010 / 208 / 091 / 065 / 223 / 174 / 240`），共 **18 条支线**。
> C 层 86 人按字段矩阵**不带 `hooks`**，**不在本次范围**。

---

## 0. 三条关键前置发现（先读，决定后面怎么写）

### 0.1 ⚠️ 现有 288 条 `sq_npcv_*` **已经占用了这 26 个 NPC** —— 但它们是「模板跑腿」，不是支线

实测 `game/data/60_quests.json` 共 **331 条任务**，其中 `sq_npcv_*` **288 条**（每个 `npcv_*` 一条）。逐条实读后确认：这批是**同一模板套出来的两段式跑腿**，且**模板变量串号**：

| 证据 | 实测 |
|---|---|
| 结构全同 | 2 个 stage（`go` 到某房间 → 回话）、`+exp/+pot/favor 8/say「多谢你了」`，无一例外 |
| **串号 bug** | `sq_npcv_241`（和放的采买）第 2 段写「把东西交回给**史倦客**」——史倦客不是和放的任何人，是模板从别处带过来的 |
| **落点离谱** | `sq_npcv_241` 的 `go` 目标是 `emei_qingyin`（峨眉清音洞）——一个东市高利贷主让你跑峨眉买杂货 |
| 无人物 | `desc` 全是「X 要你替他跑腿买些日用杂货」「X 有笔旧账要不回来」，没有一件具体的事 |

**结论**：主人抱怨的「AI 感」，一半就出在这里。**本交付的 18 条支线是这批模板的替代品**（不是新增第 19 条跑腿）。
→ **给工程的建议**：本批支线落地时，同 `npcv_id` 的 `sq_npcv_XXX` 模板应**被替换或降级为「杂务」**，否则同一个和放会同时挂两条任务、且其中一条把人送去峨眉。

### 0.2 id 方案：**quest id == 画像 `hooks[].id`**（前缀 `hk_`）

- 前缀 `hk_` 在 `60_quests.json` 中**占用 0 条**（已扫，`sq_` 288 / `q_` 若干 / `sqp_`·`hq_`·`pq_` 全 0）。
- 好处：`portrait.pstate.hooks` 的状态机键就是 `hooks[].id`（规格 §1.3：`{hookId: "latent|offered|done|failed"}`）。**quest id 与 hook id 同键 → 无映射层**，任务完成直接置 `pstate.hooks[id]='done'`。
- 故：**每条支线的 `id` 直接取画像里那条 hook 的 `id`**（例如 `hk_npcv_241_yinzi`），不另起号。

### 0.3 引擎能力（决定了「非战斗解法」怎么写才落地得了）

依据 `21-mainline-act3-5.md` §1.4 实测：
- **剧情入口**＝房间 `actions`（`{cmd,label,keywords,cond,failMsg,effects[]}`）；
- **抉择**＝`menu` effect，`raw="标题|选项A>效果A;;选项B>效果B"`，选项可挂任意 effect；
- **任务奖励可用**：`+exp/+pot/+money/+rep/+karma/+item/-item/+skill/+title/favor/narrate/say/flag/quest`；
- **stage 支持** `targets`（`kind ∈ {flag|item|kill|room|var|fn}`）+ `cond` + `next` + **`effects`**；
- **quest 顶层支持 `require`**（前置）。

> 全部 18 条支线的**至少一条非战斗解法**，都用 `menu` + `favor/karma/rep/flag` 实现，**不依赖战斗改数值**。

### 0.4 ⚠️ 死字段提醒：画像里最有戏的东西，玩家**现在看不见**

主理人落地实测确认：`secret` / `feuds` / `hooks` / `arc` / `role` / `voice.style` **都不在玩家可见的呈现层**（`look/talk/ask` 目前只读 `desc` + 部分字段）。
→ **结论：想让玩家知道的信息，必须写进任务文本或对话。**
→ 因此**自第二批（V10 起）**起，每条支线新增一栏 **「秘密怎么演」**：指明该 NPC 的 `secret` 由**哪句台词 / 哪段 `narrate` / 哪个动作当场演出来**，绝不指望玩家自己从画像里读到。**尤其 `secret`——那是画像里最值钱的东西，必须靠支线兑现。**（前 9 人的 18 条也一并按此标准回看，见 §9 补注。）

---

## 1. 通用规格（每条支线都遵守）

| 项 | 规格 |
|---|---|
| **quest id** | ＝ 画像 `hooks[].id`（`hk_<npcid>_<key>`） |
| **flag 命名** | `hk_<npcid>_<key>_<step>`（本方案新增；见 §3） |
| **挂牌** | 一律挂在 NPC **当前真实房间**的 `actions` 上（room id 见各条），用 `cond: {not: {flag: "<quest>_started"}}` 保证可再取 |
| **非战斗解法** | 每条 ≥1，且**数值上真的划得来**（不能是"非战斗但给 0 奖励"的摆设） |
| **可失败/可放弃** | 不做「永久消失」。放弃 → 置 `hk_..._abandoned`，NPC 好感 −X，**任务可再接**；失败（战斗输）→ 从门口重来，不删任务 |
| **奖励区间** | `+exp` 120–260 · `+pot` 40–70 · `+money` 150–400 · `favor` ±10–50 · `+rep` 15–25 · `+karma` 5–15 |
| **与主线** | 逐条标注「前置铺垫 / 并行 / 幕间补充」，并核**同房间、同 NPC、同时刻**三重不撞 |

---

# 2. 前 9 人 · 18 条支线

> 每条格式：**挂牌/触发** → **step 链** → **分支（≥1 非战斗）** → **奖励** → **为什么做** → **主线关系** → **失败/放弃后世界状态**。

## V01 `npcv_241` 和放（market · `jn_market_south` 东市·南巷）

### Q01 `hk_npcv_241_yinzi` 「绸缎庄的窟窿」
- **挂牌/触发**：`jn_market_south` 房间 action `[cmd:接账]`，`cond: {not:{flag:"hk_npcv_241_yinzi_go"}}`；giver `npcv_241`。
- **step 链**：
  1. 去 `jn_silk_shop`（东市·绸缎庄）问跑掉的东家留下多少亏空 → `targets:[{kind:"room",key:"jn_silk_shop",var:"hk_npcv_241_yinzi_go"}]`，`next:1`
  2. 回 `jn_market_south` 与和放对账 → `cond:{var:"hk_npcv_241_yinzi_go"}`，`next:2`
  3. 抉择 `menu`（见分支）→ `next:99`
- **分支**：`menu:"这一笔，怎么处理|替他做平>flag:hk_npcv_241_yinzi_hide;-karma:15;+money:300;;留底交官府>flag:hk_npcv_241_yinzi_report;+rep:朝廷:20;favor:npcv_241:-30"`
- **奖励**：① `+exp 150 / +pot 40 / +money 300 / favor npcv_241 +15`　② `+exp 120 / +rep 朝廷 20 / favor npcv_241 −30`
- **为什么做**：① 你会亲手看懂"印子钱是怎么滚的"；② 或者你选择让这条街上的第一个人栽跟头——**两种都改变这条街**。
- **主线关系**：**并行**（market 层）。主线三幕行前场用 `jn_market_main`，本活用 `jn_market_south`，**同区不同房**；`npcv_241` 不在主线人物表。
- **失败/放弃后世界状态**：拒接 → `hk_npcv_241_yinzi_abandoned`，和放 favor −5，可再接；选②后 `jn_silk_shop` 挂上"官府查封"的房间描述（可选，非必需）。

### Q02 `hk_npcv_241_guancai` 「寄在他这儿的棺材本」（reveal）
- **挂牌/触发**：前置 `require:{flag:"hk_npcv_241_yinzi_hide"}` 或 `favor npcv_241 ≥ 30`；`jn_market_south` action `[cmd:问账]`。
- **step 链**：
  1. 去 `jn_resident_2`（江南城·杏花巷）找老艄公 `npcv_064` 康守，问出"三笔没动" → `flag hk_npcv_241_guancai_ask`，`next:1`
  2. 回 `jn_market_south` 劝和放退那三笔 → `cond:{var:"hk_npcv_241_guancai_ask"}`，`next:2`
  3. 抉择 → `next:99`
- **分支**：`menu:"康守那三笔|替康守赎回>+karma:12;favor:npcv_064:40;flag:hk_npcv_241_guancai_done;;不劝>favor:npcv_241:10"`
- **奖励**：① `+exp 200 / +pot 60 / +karma 12 / favor npcv_064 +40`　② `+exp 80 / favor npcv_241 +10`
- **为什么做**：这是全城唯一一件**和放自己不敢碰的账**。看到它，你就知道这个人不是"纯坏"。
- **主线关系**：**幕间补充**（无主线占用）。
- **失败/放弃后世界状态**：选② → `secret` 不解锁，`hk_npcv_241_guancai_hold` 保留，日后仍可回访。

## V02 `npcv_154` 穆逢（market · `jn_wine_room` 醉仙楼·二楼雅间）

### Q03 `hk_npcv_154_maishen` 「妆匣最底下那张纸」
- **挂牌/触发**：`jn_wine_room` action `[cmd:上楼]`，或 `talk npcv_154`；giver `npcv_154`。
- **step 链**：
  1. `jn_wine_house`（醉仙楼一楼）action `[cmd:探那间房]`：看见绝食的姑娘、妆匣 → `flag hk_npcv_154_maishen_room`（可选获 `item` **新增** `deed_girl` 卖身契），`next:1`
  2. 回 `jn_wine_room` 对质穆逢 → `cond:{var:"hk_npcv_154_maishen_room"}`，`next:2`
  3. 抉择 → `next:99`
- **分支**：`menu:"这张纸，怎么办|还那姑娘>-item:deed_girl;+karma:15;favor:npcv_154:-40;;交回穆逢>+money:200;-karma:10;favor:npcv_154:20;flag:hk_npcv_154_maishen_crush"`
- **奖励**：① `+exp 180 / +pot 50 / +karma 15`　② `+exp 120 / +money 200 / favor npcv_154 +20`
- **为什么做**：穆逢的楼里，第一回有姑娘绝食到第三天。你想知道**她怎么活到今天**，也想看穆逢怎么办。
- **主线关系**：**并行**（market 层）。主线三幕行前场用 `jn_brothel_room`（qinglou），本活用 `jn_wine_room`（market）——**不同区域**。
- **失败/放弃后世界状态**：把妆匣的事说给同楼另三位鸨母（`npcv_088/121/187`，同在 `jn_wine_room`）→ `hk_npcv_154_maishen_leaked`，穆逢 favor −25，任务仍可完成但奖励 −30%。

### Q04 `hk_npcv_154_suoyin` 「素银簪」（reveal）
- **挂牌/触发**：`require:{flag:"hk_npcv_154_maishen_done"}` 且 `favor npcv_154 ≥ 70`；`jn_wine_room` action `[cmd:问簪子]`。
- **step 链**：
  1. 在 `jn_wine_room` 分别向 `npcv_088` 王若兰 / `npcv_121` 花无 / `npcv_187` 何落梅 打听"同款簪子" → 三个 `var`：`hk_154_pin_a/b/c`
  2. 三个齐 → 回穆逢 → `next:2` → 抉择
- **分支**：`menu:"同款的簪子|替她把那张纸找出来>+karma:12;flag:hk_npcv_154_suoyin_grey;;不问>favor:npcv_154:10"`
- **奖励**：① `+exp 220 / +pot 50 / +karma 12`　② `+exp 100 / favor npcv_154 +10`
- **为什么做**：同一款簪子出现在每个姑娘的妆匣里——**这个细节本身就是钩子**，不做就永远不知道穆逢的账是怎么算的。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：不选① → 穆逢保持「反」，「转灰」路径留待后用。

## V03 `npcv_010` 屈疏（market · `jn_market_west` 东市·西巷）

### Q05 `hk_npcv_010_haosun` 「账上那笔耗损」
- **挂牌/触发**：`jn_market_west` action `[cmd:盘账]`；giver `npcv_010`。
- **step 链**：
  1. 去 `jn_school`（白鹿书院·讲堂）侧访米价行情 → `flag hk_npcv_010_haosun_price`，`next:1`
  2. 回 `jn_market_west` 与屈疏做平这笔账 → `next:2` → 抉择
- **分支**：`menu:"这笔耗损|替他做平>flag:hk_npcv_010_haosun_hide;-karma:10;+money:250;;留一份底>flag:hk_npcv_010_haosun_hold;+rep:*:20;favor:npcv_010:-20"`
- **奖励**：① `+exp 200 / +pot 60 / +money 250 / favor npcv_010 +20`　② `+exp 160 / +rep * 20 / favor npcv_010 −20`
- **为什么做**：**留下那份底，你就握住了庞听（`npcv_109`）那条线的把手**——这是支线里少数能反哺更大棋局的钩子。
- **主线关系**：并行（market 层，`jn_market_west` ≠ 主线 `jn_market_main`）。
- **失败/放弃后世界状态**：选② → `hk_npcv_010_haosun_hold` 永久保留，日后可作要挟/揭发的入口（世界状态改变）。

### Q06 `hk_npcv_010_fuxue` 「府学门口那道门」（encounter）
- **挂牌/触发**：`favor npcv_010 ≥ 30`；`jn_market_west` action `[cmd:说句话]`。
- **step 链**：
  1. 去 `jn_school` action `[cmd:找门房]` → 得知他儿子被拦了三回 → `flag hk_npcv_010_fuxue_block`，`next:1`
  2. 抉择（三条路，**全非战斗**）→ `next:99`
- **分支**：`menu:"这道门|使钱>−money:80;flag:hk_npcv_010_fuxue_money;;凭名声>+rep:*:0;cond-rep≥30;flag:hk_npcv_010_fuxue_fame;;不管>favor:npcv_010:-20"`
- **奖励**：使钱 `+exp 140 / +karma 8 / favor npcv_010 +30`；凭名声 `+exp 180 / +karma 8 / favor npcv_010 +30`；不管 `favor npcv_010 −20`
- **为什么做**：一个靠粮价吃人的米行东家，会为了儿子在府学门口被人拦而心里发怵——**你想看看他还有没有人心**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选"不管" → 屈疏 favor −20，任务可再接。

## V04 `npcv_208` 孔拾月（harbor · `jn_harbor_shed` 码头·货栈）

### Q07 `hk_npcv_208_feng` 「江上那三条船」
- **挂牌/触发**：`jn_harbor_shed` action `[cmd:看船]`；giver `npcv_208`。
- **step 链**：
  1. 去 `jn_harbor_wharf`（码头·栈桥）说服三户船家靠岸 → `flag hk_npcv_208_feng_wharf`，`next:1`
  2. 回 `jn_harbor_shed` 复命 → 抉择 → `next:99`
- **分支**：`menu:"这三条船|替她压船户>+rep:*:20;+money:200;favor:npcv_208:25;;帮船户抗抽头>favor:npcv_208:-25;+rep:丐帮:15;+karma:10"`
- **奖励**：① `+exp 220 / +pot 60 / +money 200 / +rep * 20`　② `+exp 180 / +rep 丐帮 15 / +karma 10`
- **为什么做**：两条路都能 "赢"，但赢的人不一样——**这条支线的价值是让你选边**，不是刷经验。
- **主线关系**：**并行**。harbor 不在主线三~五幕房间表（主线五幕走的是 `haitan_boat` 东海渔船，跨区）。
- **失败/放弃后世界状态**：选② → 孔拾月 favor −25，码头抽头规矩松动（`hk_npcv_208_feng_loose`），日后回访有变。

### Q08 `hk_npcv_208_shaochuan` 「十年前那条船」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_208":30}}`；`jn_harbor_shed` action `[cmd:问旧事]`。
- **step 链**：
  1. `jn_harbor_shed` 打听十年前的沉船 → `flag hk_npcv_208_shaochuan_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"十年前那条船|替她瞒下>+karma:5;flag:hk_npcv_208_shaochuan_hold;;报到官上>+rep:朝廷:25;favor:npcv_208:-60;flag:hk_npcv_208_shaochuan_report"`
- **奖励**：① `+exp 200 / +pot 50 / +karma 5`　② `+exp 240 / +rep 朝廷 25`
- **为什么做**：孔拾月要的不是船，是"码头还认不认她这个主"。**十年前那条沉船的答案，就在她每年清明烧的那叠纸里。**
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选② → 触发「旧船案」世界状态，码头 NPC 对她的态度文本改变（可作后续剧情）。

## V05 `npcv_091` 樊过（market · `jn_pawnshop` 东市·当铺）

### Q09 `hk_npcv_091_xiangzi` 「府衙那只箱子」
- **挂牌/触发**：`jn_pawnshop` action `[cmd:搭话]`；giver `npcv_091`。
- **step 链**：
  1. 去 `jn_yamen_back`（衙门·后衙）看那口箱子什么时候出 → `flag hk_npcv_091_xiangzi_scout`，`next:1`
  2. 回 `jn_pawnshop` → 抉择 → `next:99`
- **分支**：`menu:"那只箱子|替他探明白>flag:hk_npcv_091_xiangzi_open;-karma:5;+money:150;+pot:60;;劝他收手>favor:npcv_091:30;+karma:10;flag:hk_npcv_091_xiangzi_stop"`
- **奖励**：① `+exp 200 / +pot 60 / +money 150`　② `+exp 240 / +karma 10 / favor npcv_091 +30`
- **为什么做**：他是这条街上**唯一一个会给人留棉袄的贼**。你替他探这口箱子，等于在探他会走多远。
- **主线关系**：**并行**。主线二幕用 `jn_yamen_office`（胡录事签押房），本活用 `jn_yamen_back`（后衙）——**不同房间**。
- **失败/放弃后世界状态**：选① → 触发「黑箱」事件链（`hk_blackbox` 系列 flag 开端）；选② → 樊过收手，`jn_pawnshop` 夜里不再有"跟箱子的人"。

### Q10 `hk_npcv_091_mianao` 「两个小子的棉袄」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_091":40}}`；`jn_pawnshop` action `[cmd:看那两件棉袄]`。
- **step 链**：
  1. `jn_pawnshop` 撞见他在缝棉袄 → `flag hk_npcv_091_mianao_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"两件棉袄|送小子去书院>-money:60;+karma:12;favor:npcv_091:20;;不问>favor:npcv_091:10"`
- **奖励**：① `+exp 200 / +karma 12 / favor npcv_091 +20`　② `+exp 100 / favor npcv_091 +10`
- **为什么做**：贼不缺恨，缺一处软。**这两件棉袄就是那个软处。**
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：无惩罚；两个小子日后可作书院线彩蛋 NPC（**新增 NPC**，本批不建）。

## V06 `npcv_065` 杜听涛（market · `jn_teahouse` 东市·老茶馆）

### Q11 `hk_npcv_065_siqiliang` 「元若那四十七两」
- **挂牌/触发**：`jn_teahouse` action `[cmd:陪他坐坐]`；giver `npcv_065`。
- **step 链**：
  1. 找同室的 `npcv_073` 元若说情 → `flag hk_npcv_065_siqiliang_yuan`，`next:1`
  2. 抉择（三条，全非战斗）→ `next:99`
- **分支**：`menu:"这四十七两|替他还>−money:47;favor:npcv_065:30;flag:hk_npcv_065_siqiliang_paid;;逼他开口>+money:47;favor:npcv_065:-30;flag:hk_npcv_065_siqiliang_press;;替他把话说透>favor:npcv_073:20;+karma:10;flag:hk_npcv_065_siqiliang_truth"`
- **奖励**：① `+exp 200 / +pot 50 / favor npcv_065 +30`　② `+exp 120 / +money 47 / favor npcv_065 −30`　③ `+exp 260 / +karma 10 / favor npcv_073 +20`（**元若要的其实是那句实话**）
- **为什么做**：元若赊了他三年，**要的不是银子**。你把这句话翻译出来，支线就有了魂。
- **主线关系**：**并行**。`jn_teahouse` 不在主线房间表；`npcv_073` 是「保留像」不参与主线。
- **失败/放弃后世界状态**：选② → 杜听涛 favor −30，`hn_` 剧情留口；三条路都不删任务。

### Q12 `hk_npcv_065_ziju` 「怀里那张字据」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_065":65}}`；`jn_teahouse` action `[cmd:问官银]`。
- **step 链**：
  1. `jn_teahouse` 逼出那批官银的来路 → `flag hk_npcv_065_ziju_ask`（可获 `item` **新增** `iou_du` 字据），`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"这张字据|交给元若>-item:iou_du;favor:npcv_073:30;favor:npcv_065:-50;;替他烧了>-item:iou_du;+karma:5;favor:npcv_065:40;flag:hk_jiuzhangfang"`
- **奖励**：① `+exp 240 / favor npcv_073 +30`　② `+exp 220 / +karma 5 / favor npcv_065 +40`
- **为什么做**：三十年的赌，一晚上的字据——**你还他一个清白，或者还他一个干净**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选② → 开「旧账房」事件线（`hk_jiuzhangfang`），粮行旧案的线索留待后用。

## V07 `npcv_223` 蓝若愚（gusu · `gusu_yanzi` 姑苏·燕子坞）

### Q13 `hk_npcv_223_meimei` 「枫桥那个人贩子」
- **挂牌/触发**：`gusu_yanzi` action `[cmd:问他腿]`；giver `npcv_223`。
- **step 链**：
  1. 去 `gusu_zhai_lane`（姑苏·世家巷）打探人贩子的落脚 → `flag hk_npcv_223_meimei_trail`，`next:1`
  2. 去 **新增房间** `gusu_fengqiao`（姑苏·枫桥）与人贩子对质 → `next:2` → 抉择
- **分支**：`menu:"那个人|问出妹妹的下落>+karma:15;favor:npcv_223:40;flag:hk_npcv_223_meimei_found;;收钱闭嘴>+money:300;-karma:15;flag:hk_npcv_223_meimei_silent;;动手>combat:mob_bandit`
- **奖励**：① `+exp 260 / +pot 70 / +karma 15 / favor npcv_223 +40`　② `+exp 120 / +money 300 / −karma 15`　③ 战斗 `+exp 200`
- **为什么做**：一个翻了十二年乱葬岗的年轻人，**你替他问出那句话，就是在替这世上少一个"没名字的人"**。
- **主线关系**：**并行**。gusu 不在主线三~五幕房间表。
- **失败/放弃后世界状态**：动武失败 → 从 `gusu_yanzi` 门口重来，任务不删；选③后 `gusu_fengqiao` 的"那个人"仍在（可再访）。

> ⚠️ **新增房间** `gusu_fengqiao`：单出口连 `gusu_zhai_lane`（或 `gusu_town`），**必须成对写反向边**（`A.d→B ⇒ B.opp→A`，B13 已收紧成硬断言）。

### Q14 `hk_npcv_223_laoxiapo` 「城外那个瞎婆」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_223":40}}`；`gusu_town`（姑苏城外）action `[cmd:问瞎婆]`。
- **step 链**：
  1. `gusu_town` 找到瞎婆，对照蓝若愚给的信物 → `flag hk_npcv_223_laoxiapo_found`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那位瞎婆|替蓝若愚认下她>+karma:10;favor:npcv_223:30;flag:hk_npcv_223_laoxiapo_ack;;什么都不说>favor:npcv_223:-10"`
- **奖励**：① `+exp 200 / +karma 10 / favor npcv_223 +30`　② `+exp 80 / favor npcv_223 −10`
- **为什么做**：他偷来的钱一分没花，全给了城外一个瞎婆——**你想知道那声"不敢认"背后是什么**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：无惩罚，任务可再接。

## V08 `npcv_174` 蒋倦（market · `jn_pottery` 东市·窑场）

### Q15 `hk_npcv_174_tuntang` 「仓里那三个月」
- **挂牌/触发**：`jn_pottery` action `[cmd:看仓]`；giver `npcv_174`。
- **step 链**：
  1. 去 **新增房间** `jn_granary`（东市·粮仓）掺米 → `flag hk_npcv_174_tuntang_do`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"这批米|替他掺了>-karma:20;+money:400;flag:hk_npcv_174_tuntang_mix;;报到官上>+rep:朝廷:25;favor:npcv_174:-50;flag:hk_npcv_174_tuntang_report"`
- **奖励**：① `+exp 200 / +pot 70 / +money 400 / −karma 20`　② `+exp 240 / +rep 朝廷 25`
- **为什么做**：城里旱象已起，**你手里那袋米会决定谁今晚有饭吃**——这是所有支线里后果最重的一条。
- **主线关系**：**并行**（market 层，`jn_pottery`/`jn_granary` ≠ 主线房间）。
- **失败/放弃后世界状态**：选② → `jn_granary` 挂"查封"状态，蒋倦 favor −50，全城米价文本可降（世界状态改变）。

> ⚠️ **新增房间** `jn_granary`：连 `jn_pottery`（或 `jn_market_north`），同样**必须成对反向边**。

### Q16 `hk_npcv_174_zhangxin` 「掌心里那把米」（reveal）
- **挂牌/触发**：`require:{flag:"hk_npcv_174_tuntang_mix"}` 且 `favor npcv_174 ≥ 70`；`jn_pottery` action `[cmd:看他开仓]`。
- **step 链**：
  1. `jn_pottery` 看他抓米搓手 → `flag hk_npcv_174_zhangxin_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"他搓的那把米|劝他改>+karma:10;favor:npcv_174:20;flag:hk_npcv_174_zhangxin_grey;;接着合伙>+money:200;−karma:5"`
- **奖励**：① `+exp 200 / +karma 10 / favor npcv_174 +20`　② `+exp 120 / +money 200`
- **为什么做**：一个把米搓了三十年的人，**搓的不是米**。这条的任务就是把这个动作读出来。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 蒋倦「转灰」标记，日后可作正面支线接口。

## V09 `npcv_240` 邬修远（market · `jn_market_north` 东市·北巷）

### Q17 `hk_npcv_240_laocaifeng` 「三年攒的那匹绸」
- **挂牌/触发**：`jn_market_north` action `[cmd:看货]`；giver `npcv_240`。
- **step 链**：
  1. 去 `jn_silk_shop`（绸缎庄）剪开那匹绸验货 → `flag hk_npcv_240_laocaifeng_cut`（可获 `item` **新增** `fake_silk` 掺麻的绸），`next:1`
  2. 回 `jn_market_north` → 抉择 → `next:99`
- **分支**：`menu:"这匹绸|劝他换真货>+karma:10;favor:npcv_240:30;flag:hk_npcv_240_laocaifeng_honest;;帮他把货卖出>+money:200;−karma:10;flag:hk_npcv_240_laocaifeng_sold"`
- **奖励**：① `+exp 220 / +pot 50 / +karma 10 / favor npcv_240 +30`　② `+exp 140 / +money 200 / −karma 10`
- **为什么做**：那匹绸是**一个聋哑老裁缝攒了三年的寿衣料**。剪开它，你就得替一个人做决定。
- **主线关系**：**并行**。⚠️ **与 Q01 共用 `jn_silk_shop`**（V01 的绸缎庄窟窿也在此）——两条支线**不同 quest、可先后**，但工程需保证两套 `jn_silk_shop` 房间 action 的 `cond` **互斥/可并发**（见 §4 冲突表）。
- **失败/放弃后世界状态**：选② → 老裁缝线以"被坑"收尾（`hk_laocaifeng_cheated`），日后有后续可能。

### Q18 `hk_npcv_240_shouyi` 「箱底那件料子」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_240":60}}`；`jn_market_north` action `[cmd:翻箱底]`。
- **step 链**：
  1. `jn_market_north` 翻出他每年腊月裁的那件料子 → `flag hk_npcv_240_shouyi_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"箱底那件料子|劝他穿上>+karma:8;favor:npcv_240:25;flag:hk_npcv_240_shouyi_wear;;不问>favor:npcv_240:10"`
- **奖励**：① `+exp 200 / +karma 8 / favor npcv_240 +25`　② `+exp 90 / favor npcv_240 +10`
- **为什么做**：一个卖了半辈子假料子的人，**箱底压着一件自己裁、从没穿过的好料**。这件料子就是他的判词。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：开「旧料案」线索（`hk_jiuliaofang`），留待后用。

---

## 3. 新增 id 清单（本方案提出，工程落地时需建）

| 类别 | id | 用途 | 备注 |
|---|---|---|---|
| **房间** | `gusu_fengqiao` | 姑苏·枫桥（Q13 对质人贩子） | 连 `gusu_zhai_lane`；**必须成对反向边** |
| **房间** | `jn_granary` | 东市·粮仓（Q15 掺米） | 连 `jn_pottery` 或 `jn_market_north`；**成对反向边** |
| **物品** | `ledger_yinzi` | 和放的印子账本 | Q01（可省略为 flag） |
| **物品** | `deed_girl` | 绝食姑娘的卖身契 | Q03 |
| **物品** | `ledger_haosun` | 屈疏的耗损账底 | Q05 |
| **物品** | `iou_du` | 杜听涛怀里那张字据 | Q12 |
| **物品** | `fake_silk` | 邬修远掺麻的绸 | Q17 |
| **flag** | `hk_<npcid>_<key>_<step>` | 全部 18 条支线的进度/分支标记 | 命名见 §1 |
| **quest** | `hk_<npcid>_<key>` | **18 条支线本体**（＝画像 hooks id） | 前缀 `hk_` 全库未占用 |

> 其余全部引用**真实存在**的 id（room / npc / item / skill 已逐条核对，见 §5）。

---

## 4. 与主线（`design/21-mainline-act3-5.md`）的冲突核对

> 这是最重要的一栏，**照实说**。

### 4.1 逐项核对结果：**本批 18 条支线，与主线三~五幕「零冲突」**

| 核对维度 | 结果 |
|---|---|
| **同 NPC** | 主线三幕的 7 条「拉回路径」用 `npcv_180`/`252`/`090`/`248`/`164`/`186`/`082`；**本批 9 人（V01–V09）无一在这 7 人之内** → 无重叠 |
| **同房间** | 主线三~五幕房间表（`21` §1.2）共 30 间。本批用到 `jn_market_south/west/north`、`jn_wine_room`、`jn_wine_house`、`jn_teahouse`、`jn_pottery`、`jn_pawnshop`、`jn_silk_shop`、`jn_harbor_shed`、`jn_harbor_wharf`、`jn_yamen_back`、`jn_school`、`jn_resident_2`、`gusu_*` → **与主线房间表交集为空** |
| **易错点 1** | 主线二幕用 `jn_yamen_office`（胡录事签押房）；本批 Q09 用 `jn_yamen_back`（后衙）——**不同房间**，✅ 不撞 |
| **易错点 2** | 主线三幕行前场用 `jn_market_main`（东市·大街）；本批用 `jn_market_south/west/north`——**同区不同房间**，✅ 不撞 |
| **易错点 3** | 主线三幕行前场用 `jn_brothel_room`（qinglou）；本批 Q03 用 `jn_wine_room`（market 醉仙楼二楼）——**不同区域**，✅ 不撞 |

### 4.2 唯一同房间点（本批**内部**，非主线）：`jn_silk_shop`

**Q01**（和放的绸缎庄窟窿）与 **Q17**（邬修远的掺麻绸）**都要进 `jn_silk_shop`**。
- **不冲突**：两条 quest id 不同、可先后完成；
- **给工程的要求**：`jn_silk_shop` 的 `actions` 要**同时容纳两个入口**，各自带 `cond`（`not started` / `require`），并在标签上区分（如「看那匹绸」vs「问那笔亏空」）；
- **建议**：Q01 的 `cond` 加 `require:{not:{quest:"hk_npcv_240_laocaifeng"}}` 之类的互斥，避免玩家在同一屏看到两段互不相干的对话。**这条需工程定夺**。

### 4.3 与主线是「什么关系」（逐条定性）

本批 18 条**全部不阻塞主线**，定性如下：
- **并行**（玩家在 market/harbor/gusu 自由可做）：Q01 Q03 Q05 Q07 Q09 Q11 Q13 Q15 Q17（9 条）
- **幕间补充**（主线空档期做的"江湖里的人"）：Q02 Q04 Q06 Q08 Q10 Q12 Q14 Q16 Q18（9 条）
- **前置铺垫**：**0 条** —— 我**刻意不把支线做成主线前置**，因为主线三~五幕的入场条件已在 `21` 里定死（`know_zhenyi` 等），硬塞前置会**卡住主线**。

> **给团队的一句判断**：如果日后要把某条支线的产物（如 Q05 的 `hk_npcv_010_haosun_hold`、Q15 的粮价状态）接进主线，
> 建议走**可选的旁支助攻**（有则省力、无也能过），而**不是**设成硬门槛。

---

## 5. 【前 9 人】id 自查（命中率）

> 方法：抽取本文全部反引号中的**候选 id**（含下划线、非前缀片段），逐项对照 `GameEngine({seed:20261010}).boot()` 后的 `rooms/npcs` + `20_items.json` + `10_skills.json` + `60_quests.json` + `portraits-new.json`。**脚本已跑，结果如下。**

| 类别 | 数量 | 结论 |
|---|---|---|
| **候选 id**（含下划线） | **119** | — |
| ① **真实命中** | **59** | room 22 · npc 17 · item 1 · quest 1 · **画像 hook 18** |
| ② **新增**（本文 §3 清单 + `hk_` 系列） | **59** | 房间 2 + 物品 5（=7，均为纯新 id）**＋ 52 个 `hk_`**（quest/flag，已列清单） |
| ③ 主线 flag（`design/21` 已定义，非本方案新造） | **1**（`know_zhenyi`） | 仅用于冲突说明 |
| ④ **编造**（查无此 id 且未标新增） | **0** | ✅ **无编造** |

> 复核：59 + 59 + 1 = 119，与候选总数**吻合**。

### 5.1 真实命中的 id（本批引用的非 `hk_` id）
- **房间（22）**：本批自用 17 处 —— `jn_market_south` `jn_market_west` `jn_market_north` `jn_silk_shop` `jn_wine_room` `jn_wine_house` `jn_teahouse` `jn_pottery` `jn_pawnshop` `jn_harbor_shed` `jn_harbor_wharf` `jn_yamen_back` `jn_school` `jn_resident_2` `gusu_yanzi` `gusu_zhai_lane` `gusu_town`；**另 5 处仅出现在 §4 冲突核对**（`jn_market_main` `jn_brothel_room` `jn_yamen_office` `haitan_boat` `emei_qingyin`，均为**主线/既有**房间，用于证明"不撞"）。
- **NPC（17）**：本批 9 位主角 `npcv_241` `npcv_154` `npcv_010` `npcv_208` `npcv_091` `npcv_065` `npcv_223` `npcv_174` `npcv_240` ＋ 8 位配角 `npcv_064` `npcv_073` `npcv_088` `npcv_121` `npcv_187` `npcv_109` `npcv_180` `mob_bandit`
- **物品（1）**：`wine_jar`（Q06 分支"使钱"道具）
- **quest（1）**：`sq_npcv_241`（§0.1 举证用，实读样本）

> 注：`hk_npcv_XXX_key` 形式的 **quest id 全部取自 `portraits-new.json` 的 `hooks[].id`**（26 人中 V01–V09 共 18 条），属「画像已定义」，非新造。

---

## 6. 【前 9 人】数据缺口（照实说）

1. **`jn_silk_shop` 一脚踏两船**（Q01/Q17 同房）：现有房间 `actions` 是否支持**多入口 + 各自 cond**？实测全图 `actions` 共 102 处，**未见同房间挂 2 个以上带 cond 入口的样例** → 需工程确认，否则 Q17 要挪到 `jn_market_north` 就地"看货"。
2. **与既有 288 条 `sq_npcv_*` 的处置未定**：本批 18 条与同 `npcv_id` 的模板任务**并存会打架**（同一个和放挂两条任务）。**需要主理人拍板**：替换 / 保留但改名"杂务" / 并存但要加 `require` 互斥。
3. **`jn_market_south` / `jn_granary` 等房间的 `actions` 槽位**：本批 18 条各自需要一个房间入口，**market 区将新增约 10 个 action** → 需确认 UI 承载（房间命令列表是否会挤爆）。
4. **`require` 的 `favor` 条件写法**：实测 quest 顶层 `require` 已存在，但样本里 `favor` 型 require 的**确切键名**未在本批逐条验证（我用 `require:{favor:{"npcv_208":30}}`）→ 落地前请工程按 `modapi.js#evalCond` 实际支持的键名对齐。
5. **`menu` 选项挂 `cond-rep≥30`**（Q06 分支②）：`menu` 的每个选项是否支持**前置条件判定**（不满足则灰显/不出现）？`21` §1.4 只证明"选项可挂任意 effect"，**未证明可挂 cond** → 若不可，Q06 的"凭名声"改为 effect 内自判。

---

## 7. 【前 9 人】分批建议（回答主理人的问）

**"先交前 9 人再看"是合适的**，理由：
- 前 9 人是**市井/商路**一簇（恶霸 4 + 市井恶徒 3 + 奸商 2 的一部分），**18 条里 8 条带"拉回/转灰"分支**，足以验证三类笔法：**该不该拿、该不该说、该不该留底**。
- 后 17 人（V10–V26）里 **7 人已被主线三~五幕占用**（`npcv_180`/`252`/`090`/`248`/`164`/`186`/`082`）—— 那批的写法要**统一处理"不与主线同刻占同一 NPC"**，是**另一种结构**，适合**看过前 9 人后再定调**。
- 因此建议：**确认前 9 人后，后 17 人再分两批**（V10–V17 官/酷吏/商；V18–V26 邪派/背叛/伪君子），**每批交付前再核一次主线冲突**。

---
---

# 第二批：V10–V17（官 / 酷吏 / 商）· 16 条支线

> 8 位 NPC × 2 hook = **16 条**。格式同前，另加 **「秘密怎么演」**（§0.4 死字段要求）。
> ⚠️ **本批含 2 位被主线占用的 NPC**：`npcv_248` 俞初（三幕拉回#4）、`npcv_180` 乐知（三幕拉回#1）。**处理方式逐条写明**（见各条「主线关系」）。

## V10 `npcv_009` 熊时（jiangnan · `jiangnan_market` 江南城·市集）

### Q19 `hk_npcv_009_baizi` 「那幅百子图」
- **挂牌/触发**：`jiangnan_market` action `[cmd:看绣坊]`；giver `npcv_009`。
- **step 链**：
  1. 在 `jiangnan_market` 找绣娘 `npcv_011` 喻凝（**同房**）看那幅绣了三年的百子图 → `flag hk_npcv_009_baizi_look`，`next:1`
  2. 回熊时处抉择 → `next:99`
- **分支**：`menu:"那幅图|替她卖出去>+money:10;-karma:5;favor:npcv_009:20;;替绣娘说情>+karma:10;favor:npcv_009:-10;flag:hk_npcv_009_baizi_grey"`
- **奖励**：① `+exp 150 / +money 10 / favor npcv_009 +20`　② `+exp 200 / +pot 40 / +karma 10`
- **秘密怎么演**：熊时 `secret`＝"放账不立字据，全凭一张嘴"。**由她自己一句台词演出来**：`narrate:"熊时把算珠一推：我不写字据。名字，我记在脑子里。"`
- **为什么做**：一幅绣了三年的图，抵九两债——**你想看谁先松口**。
- **主线关系**：**并行**。`jiangnan_market` 不在主线三~五幕房间表；`npcv_009` 不在主线人物表。
- **失败/放弃后世界状态**：可再接；选②后熊时「转灰」标记。

### Q20 `hk_npcv_009_shuoshu` 「说书人那张嘴」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_009":30}}` 且 Q19 完成；`jn_teahouse` action `[cmd:听说书]`。
- **step 链**：
  1. 去 `jn_teahouse` 找说书人（**新增 NPC** `hk_storyteller`，待补）听说他在念哪几个名字 → `flag hk_npcv_009_shuoshu_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"说书人那张嘴|买断他>−money:120;favor:npcv_009:30;;让债户知晓>+rep:*:15;favor:npcv_009:-40;flag:hk_npcv_009_shuoshu_liang"`
- **奖励**：① `+exp 220 / +pot 50`　② `+exp 260 / +rep * 15`
- **秘密怎么演**：`secret`＝"谁赖账就把名字说给说书人听"。**由说书人的鼓词念出三个赖账者姓名**——玩家一听就懂"这张嘴就是她的字据"。
- **为什么做**：全城最有"字据"的人，是一个**不识字**的女人。她的武器是别人的嘴。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选② → 「联名」事件线索（`hk_npcv_009_shuoshu_liang`）保留，债户可后续联合。

## V11 `npcv_237` 李无咎（market · `jn_pawnshop` 东市·当铺）

### Q21 `hk_npcv_237_daoshang` 「那口刀伤」
- **挂牌/触发**：`jn_pawnshop` action `[cmd:抓药]`；giver `npcv_237`。
- **step 链**：
  1. 去 `jm_underground`（东市·地下黑市）打听这口刀路 → `flag hk_npcv_237_daoshang_ask`，`next:1`
  2. 回 `jn_pawnshop` → 抉择 → `next:99`
- **分支**：`menu:"那口刀伤|替他递话>favor:npcv_237:30;favor:npcv_091:20;flag:hk_daolu;;报到官上>+rep:朝廷:25;favor:npcv_237:-50"`
- **奖励**：① `+exp 200 / +pot 50 / favor npcv_237 +30`　② `+exp 180 / +rep 朝廷 25`
- **秘密怎么演**：`secret`＝"替盗贼治伤、不报官"。**由他台词演出来**：`say:「治好了不报官——这是我抓药的规矩。」`
- **为什么做**：一个"只认钱"的郎中，**收的诊金比官面赏格高三倍**却不报官——你想知道那条线他划在哪。
- **主线关系**：**并行**（market）。`jm_underground` 不在主线房间表。
- **失败/放弃后世界状态**：选② → 李无咎 favor −50、`hk_daolu` 线断；任务可再接。

### Q22 `hk_npcv_237_cheng` 「秤砣上那点尘」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_237":40}}`；`jn_pawnshop` action `[cmd:问他擦秤]`。
- **step 链**：
  1. 陪他去 **新增房间** `jn_yizhuang`（城西·义庄旧址）走一趟 → `flag hk_npcv_237_cheng_go`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那杆秤|陪他在义庄站一会儿>+karma:8;favor:npcv_237:25;flag:hk_npcv_237_cheng_grey;;不问>favor:npcv_237:10"`
- **奖励**：① `+exp 200 / +karma 8 / favor npcv_237 +25`　② `+exp 90 / favor npcv_237 +10`
- **秘密怎么演**：`secret`＝"义庄验伤十年"。**由他在义庄门口一段独白演出**（`narrate`），不讲道理，只讲一件具体的事：`「那年我验过一个孩子。娘抱着他来的，说只是睡着了。」`
- **为什么做**：他每天擦那杆秤——**擦的不是尘**。这条支线就是把那个动作翻译成人话。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：无惩罚；`jn_yizhuang` 若建，日后可作"验伤"类活动的固定点。

> ⚠️ **新增房间** `jn_yizhuang`：连 `jiangnan_west_road`（或 `jiangnan_temple`），**必须成对反向边**。
> ⚠️ **新增 NPC** `hk_storyteller`（说书人）@ `jn_teahouse`：Q20 需要；**待补**。

## V12 `npcv_248` 俞初（xixia · `road_xixia_1` 西夏官道）—— ⚠️ **主线占用**

> **冲突处理（重要）**：主线三幕**拉回#4** 就是俞初，拉回动作在 `road_xixia_1`，给 `yu_ledger` 假账册；堕落动作为"替常拂翻案"。
> 我的两条 hook 与它**同源、同房、同 NPC** → 因此**一律限定为「主线之后」收尾**，加 `require:{flag:"know_zhenyi"}`（三幕已过），**不与主线行前场同刻**。并**按主线分支二选一改判**（见下）。

### Q23 `hk_npcv_248_jiushui` 「三年前那一笔」
- **挂牌/触发**：`require:{flag:"know_zhenyi"}`（三幕之后）；`road_xixia_1` action `[cmd:翻卷宗]`。
- **step 链**：
  1. 去 `xixia_ice`（西夏·冰窖，卷宗存处）抽出那张假账 → `flag hk_npcv_248_jiushui_find`，`next:1`
  2. 抉择（**按主线分支改判**）→ `next:99`
- **分支**：
  - 若主线走**拉回线**（玩家已有 `yu_ledger`）：`menu:"这张假账|把抄本留在手上>flag:hk_npcv_248_jiushui_copy;+rep:朝廷:30;;当她的面烧了>−karma:20;+money:400"`
  - 若主线走**堕落线**（常拂已复职）：`menu:"这张假账|交给常拂>+karma:15;+rep:朝廷:30;;替她压下>+money:300;−karma:10"`
- **奖励**：`+exp 220–260 / +pot 60 / ±money 300–400 / ±karma 10–20 / +rep 朝廷 30`
- **秘密怎么演**：`secret`＝"做假账、把罪扣在 17 岁的常拂头上"。**由卷宗文本 + 俞初一句独白演出来**：`narrate:"卷宗里那一页，户头写着一个死人。墨色比别处新。"` `say:「她那年才十七。我记得。」`
- **为什么做**：主线里她只是个"拉回选项"；**这条支线让你回来收这个尾**——她到底认不认。
- **主线关系**：**主线之后收尾**（`require know_zhenyi`），与主线**不同时刻**。
- **失败/放弃后世界状态**：可再接；两条改判互斥，未选的那条以 `_hold` 保留。

### Q24 `hk_npcv_248_changfu` 「关外那个孩子」（reveal）
- **挂牌/触发**：`require:{flag:"know_zhenyi"}` 且 Q23 完成；`road_xixia_1` action `[cmd:找常拂]`。
- **step 链**：
  1. 在 `road_xixia_1` 找捕快 `npcv_049` 常拂（**同房**）→ `flag hk_npcv_248_changfu_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"关外那个孩子|替她讨回清白>+karma:15;favor:npcv_049:40;flag:hk_npcv_248_changfu_clear;;不插手>favor:npcv_248:10"`
- **奖励**：① `+exp 240 / +karma 15 / favor npcv_049 +40`　② `+exp 100 / favor npcv_248 +10`
- **秘密怎么演**：`secret`＝"害常拂顶罪"。**由常拂的台词反演**（她不知道真相，但说得出当年的事）：`say:「那年我查出一笔账，第二天我就被革了。我一直没想明白是谁。」`
- **为什么做**：两个女人在同一个房间里，**一个知道全部，一个什么都不知道**。这条支线的戏就在这中间。
- **主线关系**：**主线之后收尾**。
- **失败/放弃后世界状态**：选② → 常拂线保持未了结，日后可再访。

## V13 `npcv_215` 闵春晓（tangmen · `road_tangmen_2` 蜀中官道）

### Q25 `hk_npcv_215_yanyin` 「那半张盐引」
- **挂牌/触发**：`road_tangmen_2` action `[cmd:批盐引]`；giver `npcv_215`。
- **step 链**：
  1. 去 `tangmen_hall`（唐门·前厅）找 `npcv_134` 祁疏打听盐引旧事 → `flag hk_npcv_215_yanyin_ask`，`next:1`
  2. 回 `road_tangmen_2` → 抉择 → `next:99`
- **分支**：`menu:"那半张盐引|替她烧干净>+karma:12;favor:npcv_215:40;flag:hk_npcv_215_yanyin_done;;留底要挟>+money:500;−karma:25;flag:hk_npcv_215_yanyin_hold"`
- **奖励**：① `+exp 240 / +pot 60 / +karma 12 / favor npcv_215 +40`　② `+exp 140 / +money 500 / −karma 25`
- **秘密怎么演**：`secret`＝"给孟明亡母留过一笔钱，那钱是头一回的盐商孝敬"。**由她烧纸的动作 + 一句台词演出来**：`narrate:"她把那半张盐引举到灶前，火起来又灭——纸边焦了，她没烧。"` `say:「烧了十年，粘不回原样。」`
- **为什么做**：她烧了十年的东西**一直没烧掉**——你想知道她在等什么。
- **主线关系**：**并行**。`road_tangmen_2` 不在主线房间表（主线三幕走的是 `road_beijiang_1`/`road_xiyu_1`/`road_xixia_1`）。
- **失败/放弃后世界状态**：选② → `hk_npcv_215_yanyin_hold` 永久保留（可后续要挟/揭发）。

### Q26 `hk_npcv_215_mengming` 「孟明亡母那笔钱」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_215":65}}`；`miaojiang_sheng`（苗疆·圣地）action `[cmd:找孟明]`。
- **step 链**：
  1. 在 `miaojiang_sheng` 找店伙 `npcv_206` 孟明，问出他亡母那副药 → `flag hk_npcv_215_mengming_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那副药|告诉他>+karma:10;favor:npcv_215:-10;flag:hk_npcv_215_mengming_tell;;替他保密>favor:npcv_215:10"`
- **奖励**：① `+exp 220 / +karma 10`　② `+exp 100 / favor npcv_215 +10`
- **秘密怎么演**：`secret`＝"给孟明亡母留过钱"。**由孟明的一句台词反演**：`say:「我娘那副药，我一直不知道是谁出的钱。问她，她只说遇上了好人。」`
- **为什么做**：一个收盐商孝敬的官，**把第一笔孝敬留给了孤儿寡母**——你想知道她图什么。
- **主线关系**：幕间补充（`miaojiang_sheng` 不在主线房间表）。
- **失败/放弃后世界状态**：无惩罚，可再接。

## V14 `npcv_180` 乐知（market · `jn_market_main` 东市·大街）—— ⚠️ **主线占用**

> **冲突处理（重要）**：主线三幕**拉回#1** 就是乐知，拉回动作在 `jn_market_main`，给 `yue_zhi_road` 北线小路。
> 我的两条 hook 与它**同源、同房** → 拆成**两个时间窗**，都不与主线同刻：①`beibian`＝**三幕之前的前置铺垫**（`require: 尚未知伪秘籍线`）；②`qi`＝**五幕之后的收尾**（`require:{flag:"know_depot_master"}`）。

### Q27 `hk_npcv_180_beibian` 「北边那趟镖」
- **挂牌/触发**：`require:{not:{flag:"know_zhenyi"}}`（三幕**之前**）；`jn_market_main` action `[cmd:看镖车]`。
- **step 链**：
  1. 在 `jn_market_main` 验那口不写货单的箱子 → `flag hk_npcv_180_beibian_check`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"北边那趟镖|替她验货>flag:hk_heibiao;+exp:0;;劝她退镖>favor:npcv_180:30;+karma:10;flag:hk_npcv_180_beibian_stop"`
- **奖励**：① `+exp 200 / +pot 60`（开「黑镖」事件）　② `+exp 240 / +karma 10 / favor npcv_180 +30`
- **秘密怎么演**：`secret`（二十年前丢镖、报货主名头）**只演一半**：`say:「不写货单的镖，我接过大半辈子。这一趟，我头一回想先看一眼。」` 完整真相留到 Q28。
- **为什么做**：一个"谁的货都敢接"的镖头，**头一回不敢看箱子**——你跟着她一起发怵。
- **主线关系**：**三幕前置铺垫**，`require not know_zhenyi`，**与主线行前场错开时间窗**。
- **失败/放弃后世界状态**：可再接；选② → `hk_heibiao` 不触发。

### Q28 `hk_npcv_180_qi` 「车上那面旧旗」
- **挂牌/触发**：`require:{flag:"know_depot_master"}`（五幕**之后**）；`jn_market_main` action `[cmd:摘旗]`。
- **step 链**：
  1. 与她一同把车上那面旧旗摘下来 → `flag hk_npcv_180_qi_do`，`next:1`
  2. 抉择（真相在此揭）→ `next:99`
- **分支**：`menu:"车上那面旧旗|陪她认下旧账>+karma:12;favor:npcv_180:40;flag:hk_npcv_180_qi_grey;;只摘旗，不深问>favor:npcv_180:10"`
- **奖励**：① `+exp 260 / +pot 70 / +karma 12 / favor npcv_180 +40`　② `+exp 120 / favor npcv_180 +10`
- **秘密怎么演**：**完整揭开**：`narrate:"旗子落地的时候，她说了句：二十年前我押丢过一趟镖。我把货主的名头，报给了劫道的。"` `say:「那户人家，我记得姓什么。别的我记不住。」`
- **为什么做**：一面挂了二十年的旗，**摘下来要一句实话**——你在主线里可能只跟她擦肩，这条是补票。
- **主线关系**：**五幕之后收尾**，与主线**不同时刻**。
- **失败/放弃后世界状态**：选① → 乐知「转灰」；旗摘后 `jn_market_main` 的镖车描述改变（世界状态）。

## V15 `npcv_115` 费守（tangmen · `road_tangmen_1` 入蜀官道）

### Q29 `hk_npcv_115_mingan` 「这桩命案」
- **挂牌/触发**：`road_tangmen_1` action `[cmd:问案子]`；giver `npcv_115`。
- **step 链**：
  1. 去 `tangmen_hall`/`road_tangmen_2` 查那桩命案的苦主与真凶 → `flag hk_npcv_115_mingan_probe`，`next:1`
  2. 回 `road_tangmen_1` → 抉择 → `next:99`
- **分支**：`menu:"这桩命案|揪出真凶>+karma:15;favor:npcv_115:40;flag:hk_npcv_115_mingan_true;;由他随便结案>−karma:20;+money:200;flag:hk_npcv_115_mingan_fake"`
- **奖励**：① `+exp 260 / +pot 70 / +karma 15 / favor npcv_115 +40`　② `+exp 140 / +money 200 / −karma 20`
- **秘密怎么演**：`secret`＝"册子上那个被他冤枉、死在牢里的货郎"。**由他翻册子的动作演出来**：`narrate:"他把册子翻到某一页，蘸了墨，笔尖悬着——没落下去。"`
- **为什么做**："随便挑一个结案"这种事，**他不做，是因为册子上有一页他不敢翻**。
- **主线关系**：**并行**（tangmen 不在主线房间表）。
- **失败/放弃后世界状态**：选② → `hk_npcv_115_mingan_fake`，蜀中官道多一桩冤案（世界状态，可后续翻案）。

### Q30 `hk_npcv_115_ce` 「册子上那个名字」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_115":60}}`；`road_tangmen_1` action `[cmd:翻册子]`。
- **step 链**：
  1. 逼他翻到那页 → `flag hk_npcv_115_ce_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"册子上那个名字|替货郎翻案>+karma:20;favor:npcv_115:20;flag:hk_npcv_115_ce_grey;;把册子烧了>favor:npcv_115:30;−karma:5"`
- **奖励**：① `+exp 280 / +karma 20 / favor npcv_115 +20`　② `+exp 160 / favor npcv_115 +30 / −karma 5`
- **秘密怎么演**：**由他念出那个名字 + 一句独白**：`say:「二十年前有个货郎，是我办的。他死在牢里。这名字我二十年没划。」`
- **为什么做**：一个"只求结案"的人，**有一页二十年不敢划**——这条支线就是让他当着你的面划下去。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：两条互斥、都保留线索。

## V16 `npcv_083` 毕元（yamen · `jn_yamen_arch` 衙门·架阁库）

### Q31 `hk_npcv_083_guben` 「那册孤本」
- **挂牌/触发**：`jn_yamen_arch` action `[cmd:看卷]`；giver `npcv_083`。
- **step 链**：
  1. 去 `jn_bookshop`（江南城·翰墨斋）寻一册好书 → `flag hk_npcv_083_guben_find`（可获 `item` 既有 `book_rare` 宋版古籍），`next:1`
  2. 回 `jn_yamen_arch` → 抉择 → `next:99`
- **分支**：`menu:"这册孤本|拿好书换下它>−item:book_rare;+karma:10;favor:npcv_083:30;flag:hk_npcv_083_guben_swap;;逼他改判>−karma:15;+money:300;flag:hk_npcv_083_guben_force"`
- **奖励**：① `+exp 220 / +pot 60 / +karma 10 / favor npcv_083 +30`　② `+exp 140 / +money 300 / −karma 15`
- **秘密怎么演**：`secret`＝"替一桩命案改过一行字，把该偿命的改成流放"。**由他洗笔的动作 + 台词演出来**：`narrate:"他写完判词，把笔在清水里洗了三遍，洗得笔尖不剩一点墨。"` `say:「这一行字，是要人命的。我改过一行。」`
- **为什么做**：**一支笔比一柄刀快**——你想看他是怎么给自己定罪的（用一册书）。
- **主线关系**：**并行**。`jn_yamen_arch` 不在主线房间表（主线二幕用 `jn_yamen_office`）。
- **失败/放弃后世界状态**：选② → 冤案线（`hk_npcv_083_guben_force`）留口。

### Q32 `hk_npcv_083_gaizi` 「改过的那行字」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_083":65}}`；`jn_yamen_wt`（衙门·刑房）action `[cmd:调旧卷]`。
- **step 链**：
  1. 在 `jn_yamen_wt` 找出那处刮改痕迹 → `flag hk_npcv_083_gaizi_find`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"改过的那行字|替冤者翻案>+karma:15;favor:npcv_083:-30;flag:hk_npcv_083_gaizi_clear;;替他压下>favor:npcv_083:20"`
- **奖励**：① `+exp 260 / +karma 15`　② `+exp 120 / favor npcv_083 +20`
- **秘密怎么演**：**由卷宗文本直接呈现**：`narrate:"那一行字底下的纸面是毛的——刮过，又写上去。"`
- **为什么做**：他写判词从不改第二遍；**只有一桩案留着刮改的痕**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：两条互斥保留。

## V17 `npcv_126` 和苍（gaibang · `gaibang_po_miao` 丐帮·破庙）

### Q33 `hk_npcv_126_xianghuo` 「功德箱里那点钱」
- **挂牌/触发**：`gaibang_po_miao` action `[cmd:看功德箱]`；giver `npcv_126`。
- **step 链**：
  1. 在 `gaibang_po_miao` 与他清点功德箱，并看庙里另几位（`npcv_062` 屈弘 / `npcv_027` 任停 / `npcv_060` 柯云，**同房**）→ `flag hk_npcv_126_xianghuo_count`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"这点香火|分给庙里众人>+karma:10;favor:npcv_126:-10;flag:hk_npcv_126_xianghuo_share;;替他独吞>+money:200;−karma:15;favor:npcv_126:30"`
- **奖励**：① `+exp 200 / +pot 50 / +karma 10`　② `+exp 130 / +money 200 / −karma 15 / favor npcv_126 +30`
- **秘密怎么演**：`secret`＝"六年前偷过屈弘师门一尊铜像"。**由屈弘的一句牢骚先垫**：`say（npcv_062 屈弘）:「我这庙里，本有一尊铜像。后来没了。」`
- **为什么做**：一个嘴上念佛、手里数钱的和尚——**你想看他把钱怎么分**。
- **主线关系**：**并行**（gaibang 不在主线三~五幕房间表）。
- **失败/放弃后世界状态**：选① → 和苍「转灰」；破庙香火描述改变。

### Q34 `hk_npcv_126_tongxiang` 「那尊铜像」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_126":60}}`；`gaibang_po_miao` action `[cmd:问铜像]`。
- **step 链**：
  1. 向 `npcv_062` 屈弘问师门旧事 → `flag hk_npcv_126_tongxiang_ask`，`next:1`
  2. 回和苍处对质 → 抉择 → `next:99`
- **分支**：`menu:"那尊铜像|逼他还像>+karma:15;favor:npcv_062:40;favor:npcv_126:-40;flag:hk_npcv_126_tongxiang_back;;不问>favor:npcv_126:10"`
- **奖励**：① `+exp 260 / +pot 60 / +karma 15 / favor npcv_062 +40`　② `+exp 100 / favor npcv_126 +10`
- **秘密怎么演**：**由和苍自己认**（被逼到墙角才说）：`say:「那年我要饭，从那道观里拿了尊像去换钱。那道观……是他的师门。」`
- **为什么做**：他骂屈弘是"骗子"骂了六年——**骂得越响，越像在掩什么**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 和苍与屈弘关系翻转，庙产两分的可能打开。

---

## 8. 【V01–V17】模板任务替换清单（B20 处置 · 主理人已拍板）

> 主理人决定：**A 层 26 人的 `sq_npcv_*` 模板任务，由对应 `hk_*` 支线「替换」**（同一 NPC 不挂两条）。下表给出**前两批 17 位 NPC** 的对应关系；**第三批 V18–V26 的清单见 §11**。落地时：**删/停用左侧 `sq_npcv_*`，启用右侧 `hk_*`**。

| # | NPC | 被替换的模板任务 | 取代它的新支线 |
|---|---|---|---|
| 1 | `npcv_241` 和放 | `sq_npcv_241` | `hk_npcv_241_yinzi` + `hk_npcv_241_guancai` |
| 2 | `npcv_154` 穆逢 | `sq_npcv_154` | `hk_npcv_154_maishen` + `hk_npcv_154_suoyin` |
| 3 | `npcv_010` 屈疏 | `sq_npcv_010` | `hk_npcv_010_haosun` + `hk_npcv_010_fuxue` |
| 4 | `npcv_208` 孔拾月 | `sq_npcv_208` | `hk_npcv_208_feng` + `hk_npcv_208_shaochuan` |
| 5 | `npcv_091` 樊过 | `sq_npcv_091` | `hk_npcv_091_xiangzi` + `hk_npcv_091_mianao` |
| 6 | `npcv_065` 杜听涛 | `sq_npcv_065` | `hk_npcv_065_siqiliang` + `hk_npcv_065_ziju` |
| 7 | `npcv_223` 蓝若愚 | `sq_npcv_223` | `hk_npcv_223_meimei` + `hk_npcv_223_laoxiapo` |
| 8 | `npcv_174` 蒋倦 | `sq_npcv_174` | `hk_npcv_174_tuntang` + `hk_npcv_174_zhangxin` |
| 9 | `npcv_240` 邬修远 | `sq_npcv_240` | `hk_npcv_240_laocaifeng` + `hk_npcv_240_shouyi` |
| 10 | `npcv_009` 熊时 | `sq_npcv_009` | `hk_npcv_009_baizi` + `hk_npcv_009_shuoshu` |
| 11 | `npcv_237` 李无咎 | `sq_npcv_237` | `hk_npcv_237_daoshang` + `hk_npcv_237_cheng` |
| 12 | `npcv_248` 俞初 | `sq_npcv_248` | `hk_npcv_248_jiushui` + `hk_npcv_248_changfu`（**主线后收尾**） |
| 13 | `npcv_215` 闵春晓 | `sq_npcv_215` | `hk_npcv_215_yanyin` + `hk_npcv_215_mengming` |
| 14 | `npcv_180` 乐知 | `sq_npcv_180` | `hk_npcv_180_beibian`（三幕前）+ `hk_npcv_180_qi`（五幕后） |
| 15 | `npcv_115` 费守 | `sq_npcv_115` | `hk_npcv_115_mingan` + `hk_npcv_115_ce` |
| 16 | `npcv_083` 毕元 | `sq_npcv_083` | `hk_npcv_083_guben` + `hk_npcv_083_gaizi` |
| 17 | `npcv_126` 和苍 | `sq_npcv_126` | `hk_npcv_126_xianghuo` + `hk_npcv_126_tongxiang` |

**清单条数：17**（前 17 位 NPC；每人 1 条模板 → 2 条新支线）。

### 8.1 ⚠️ 附：模板任务串号 bug 的**证据档**（B20 立案用，供工程批量修其余 ~262 人）
| 问题 | 实例 | 修法要求（主理人已定） |
|---|---|---|
| **目标人名与出任务者无关** | `sq_npcv_241`（和放）第 2 段写「交给**史倦客**」 | 目标人名必须 ∈ 该 NPC 的 `rel` |
| **目的地在别的城市/区域** | `sq_npcv_241` 的 `go` 目标 `emei_qingyin`（峨眉） | 目的地必须落在该 NPC **自己所在的城市/区域** |
| **文本同质** | 全 288 条 `say「多谢你了」` + `favor 8` | 建议按 `tag` 换说法（不在本次设计范围） |

---

## 9. 【V01–V17】id 自查（脚本 · 两批合并）

> 脚本：抽本文全部反引号候选 id，对照 `rooms/npcs` + `20_items` + `10_skills` + `60_quests` + `portraits-new.json`。

| 类别 | 数量 | 说明 |
|---|---|---|
| **候选 id（含下划线）** | **223** | — |
| ① 真实命中 | **122** | room 38 / npc 31 / item 2（`book_rare`/`wine_jar`）/ quest 17 / **画像 hook 34 条** |
| ② 新增 | **97** | 房间 3（`gusu_fengqiao`/`jn_granary`/`jn_yizhuang`）· 物品 5 · **新增 NPC 1（`hk_storyteller`）** · `hk_` 系列 |
| ③ 主线 id（`design/21` 已定义） | **4** | `know_zhenyi` `know_depot_master` `yu_ledger` `yue_zhi_road` |
| ④ **编造** | **0** | ✅ |

> 复核：122 + 97 + 4 = **223**，与候选总数**吻合**。（第三批 V18–V26 写完后在 §12 一次性给三批合计。）

## 10. 【V01–V17】与主线冲突核对（新增 2 位占用 NPC 的处理）

| NPC | 主线占用（`design/21`） | 我的处理 |
|---|---|---|
| `npcv_248` 俞初 | 三幕拉回#4（`road_xixia_1`，给 `yu_ledger`） | 两条支线**均加 `require:{flag:"know_zhenyi"}`** → **主线之后收尾**，并按主线分支**二选一改判**（拉回线／堕落线各一套 `menu`） |
| `npcv_180` 乐知 | 三幕拉回#1（`jn_market_main`，给 `yue_zhi_road`） | `beibian`＝**三幕之前**（`require not know_zhenyi`）· `qi`＝**五幕之后**（`require know_depot_master`）→ **两个时间窗都避开主线行前场** |

**其余 6 人（`npcv_009`/`237`/`215`/`115`/`083`/`126`）不在主线人物表**，且所用房间与主线房间表**交集为空** → 零冲突。

---
---

# 第三批：V18–V26（邪派 / 背叛 / 伪君子）· 18 条支线

> 9 位 NPC × 2 hook = **18 条**。格式同第二批，含 **「秘密怎么演」**。
> ⚠️ **本批含 5 位被主线占用的 NPC**：`npcv_164` 皮朝颜（四幕拉回#5）、`npcv_186` 鲁半夏（四幕拉回#6）、`npcv_090` 阮听（三幕拉回#3）、`npcv_252` 陈语冰（三幕拉回#2）、`npcv_082` 夏承志（五幕拉回#7）。
> **统一处理**：**同房者用"时间窗"错开**（`require` 主线 flag 的前/后），**不同房者并行**。逐条见「主线关系」。

## V18 `npcv_164` 皮朝颜（mojiao · `mojiao_shanmen` 黑木崖·山门）—— ⚠️ **主线占用**

> 主线四幕**拉回#5** 在 `mojiao_shanmen`。故本批两条**错开时间窗**。

### Q35 `hk_npcv_164_yinzi` 「那笔周转银子」
- **挂牌/触发**：`require:{and:[{flag:"know_zhenyi"},{not:{flag:"know_depot_master"}}]}`（**三幕后 / 四幕前**）；`mojiao_shanmen` action `[cmd:问赌坊]`。
- **step 链**：
  1. 去 `mojiao_hall`（黑木崖·大殿）找教中旧账房打听银子成色 → `flag hk_npcv_164_yinzi_ask`，`next:1`
  2. 回 `mojiao_shanmen` → 抉择 → `next:99`
- **分支**：`menu:"那笔银子|替她查账>flag:hk_sirenzhang;+exp:0;;回报教中>+rep:日月神教:20;favor:npcv_164:-30"`
- **奖励**：① `+exp 240 / +pot 70`（开「死人账」链）　② `+exp 180 / +rep 日月神教 20`
- **秘密怎么演**：`secret`（死人账 / 枯井）**先露一半**：`say:「崖后有口井。我这辈子的银子，都在里头。一枚没动。」`
- **为什么做**：一个管了半辈子账的主事，**攒了一井银子却一枚没花**——你想知道那些银子是怎么来的。
- **主线关系**：**四幕行前**（`know_zhenyi` 后、`know_depot_master` 前），**与主线四幕拉回错开时间窗**。
- **失败/放弃后世界状态**：可再接；选② → 皮朝颜转冷、`hk_sirenzhang` 不触发。

### Q36 `hk_npcv_164_sirenzhang` 「死人账」（reveal）
- **挂牌/触发**：`require:{flag:"know_depot_master"}`（**四幕之后**）；`mojiao_shanmen` action `[cmd:看枯井]`。
- **step 链**：
  1. 与她下崖后看那口枯井 → `flag hk_npcv_164_sirenzhang_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"井里那些银子|揭发出去>+karma:20;flag:hk_npcv_164_sirenzhang_expose;;替她掩盖>favor:npcv_164:40;−karma:10"`
- **奖励**：① `+exp 280 / +pot 80 / +karma 20`　② `+exp 160 / favor npcv_164 +40 / −karma 10`
- **秘密怎么演**：**完整揭开**：`narrate:"账本上一笔写着'采买'两个字。日期她记得——那批孩子，是她经手的。"` `say:「我替教中放过一笔死人账。那笔钱，买过一批孩子的命。」`
- **为什么做**：她攒的银子一枚没动，**就是她没烂透的证据**——这条支线让你当面看这个证据。
- **主线关系**：**四幕之后收尾**，与主线不同时刻。
- **失败/放弃后世界状态**：选① → 教中动荡线索（`hk_npcv_164_sirenzhang_expose`）留口。

## V19 `npcv_186` 鲁半夏（qinglou · `jn_brothel_hall` 醉春楼·花厅）—— ⚠️ **主线占用**

> 主线四幕**拉回#6**（引至 `mojiao_shanmen`，其房在 `jn_brothel_hall`）。故两条**错开时间窗**。

### Q37 `hk_npcv_186_zuihua` 「雅间里那句醉话」
- **挂牌/触发**：`require:{and:[{flag:"know_zhenyi"},{not:{flag:"know_depot_master"}}]}`（**三幕后 / 四幕前**）；`jn_brothel_hall` action `[cmd:陪酒]`。
- **step 链**：
  1. 在 `jn_brothel_hall` 听她转述雅间那句醉话 → `flag hk_npcv_186_zuihua_hear`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那句话|替她压下不递>+karma:15;favor:npcv_186:40;flag:hk_npcv_186_zuihua_hold;;替她递上去>+rep:日月神教:25;favor:npcv_186:-20;flag:hk_npcv_186_zuihua_send"`
- **奖励**：① `+exp 240 / +pot 70 / +karma 15 / favor npcv_186 +40`　② `+exp 180 / +rep 日月神教 25`
- **秘密怎么演**：`secret`（哑药 / 汪秋）**先垫一句**：`say:「我这条命是捡的。捡来的命，多活一天赚一天。」`
- **为什么做**：一个**想走却走不脱**的暗桩——你替她压下一句话，等于替她多活一天。
- **主线关系**：**四幕行前**；主线 act4 拉回#6 在 `mojiao_shanmen`（**不同房**）且时间窗错开。
- **失败/放弃后世界状态**：可再接；选② → 那个官完了，鲁半夏转灰。

### Q38 `hk_npcv_186_yao` 「那味哑药」（reveal）
- **挂牌/触发**：`require:{flag:"know_depot_master"}`（**四幕之后**）；`jn_brothel_hall` action `[cmd:找汪秋]`。
- **step 链**：
  1. 在 `jn_brothel_hall` 找 `npcv_021` 汪秋（**同房**）对质 → `flag hk_npcv_186_yao_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那味哑药|助汪秋翻旧账>+karma:10;favor:npcv_021:30;flag:hk_npcv_186_yao_clear;;不问>favor:npcv_186:10"`
- **奖励**：① `+exp 240 / +karma 10 / favor npcv_021 +30`　② `+exp 100 / favor npcv_186 +10`
- **秘密怎么演**：**完整揭开**：`say:「六年前那杯酒，是我端的。汪秋被带走那天，我吐了一整夜。」`
- **为什么做**：她烧纸烧了六年——**有的纸烧得掉，有的事烧不掉**。
- **主线关系**：四幕之后收尾。
- **失败/放弃后世界状态**：选① → 汪秋线了结，鲁半夏转灰。

## V20 `npcv_090` 阮听（market · `jn_fruit_stall` 东市·果子摊）—— ⚠️ **主线占用**

> 主线三幕**拉回#3** 在 `jn_fruit_stall`（替她跑星宿海 → `ruan_cure`）。故 `jieyao` **改为三幕之后收尾**；`meimei` 不碰主线场景，**并行**。

### Q39 `hk_npcv_090_jieyao` 「丁春秋的解药」
- **挂牌/触发**：`require:{flag:"know_zhenyi"}`（**三幕之后**）；`jn_fruit_stall` action `[cmd:问他毒]`。
- **step 链**：
  1. 听他讲蛊发时的样子 → `flag hk_npcv_090_jieyao_hear`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那味解药|替他再跑一趟星宿海>favor:npcv_090:40;flag:hk_gu;;劝他离开丁春秋>+karma:10;favor:npcv_090:20;flag:hk_npcv_090_jieyao_leave"`
- **奖励**：① `+exp 260 / +pot 70 / favor npcv_090 +40`（开「蛊」链）　② `+exp 240 / +karma 10 / favor npcv_090 +20`
- **秘密怎么演**：`secret`（给亲妹妹下毒）**不在此条揭**，只演蛊：`narrate:"他讲到一半，手忽然按住腕子，指节发白，话停了。"`
- **为什么做**：他被种了七年的蛊——**你想知道他还剩多少是自己**。
- **主线关系**：**三幕之后收尾**——三幕里"星宿海"场景由主线处理，本支线是**没走拉回线的第二次机会**（或走了之后的收尾）。
- **失败/放弃后世界状态**：可再接；选① → `hk_gu` 链；选② → 阮听有脱离丁春秋的可能。

### Q40 `hk_npcv_090_meimei` 「妹妹那碗药」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_090":50}}`；`jn_fruit_stall` action `[cmd:问妹妹]`（**并行**，与主线不同场景）。
- **step 链**：
  1. 去 `gusu_yanzi`（姑苏·燕子坞）找郎中 `npcv_072` 毛清辨毒 → `flag hk_npcv_090_meimei_ask`，`next:1`
  2. 回 `jn_fruit_stall` → 抉择 → `next:99`
- **分支**：`menu:"妹妹那碗药|替他妹妹解蛊并告知真相>+karma:15;favor:npcv_090:-30;flag:hk_npcv_090_meimei_tell;;瞒下>−karma:5;favor:npcv_090:20"`
- **奖励**：① `+exp 280 / +pot 70 / +karma 15`　② `+exp 140 / favor npcv_090 +20 / −karma 5`
- **秘密怎么演**：**完整揭开**：`say:「我给她下过一味不会死的毒。就为了丁春秋信我还有用，肯续我的解药。」`
- **为什么做**：他给自己的亲妹妹下过毒——**这条支线是全剧最脏的一碗药，也是最真的一碗**。
- **主线关系**：**并行**（`gusu_yanzi`/`jn_fruit_stall` 均不在主线三幕的星宿海场景内）。
- **失败/放弃后世界状态**：两条互斥保留。

## V21 `npcv_074` 和归鸿（market · `jn_teahouse` 东市·老茶馆）

### Q41 `hk_npcv_074_yajian` 「雅间那句话」
- **挂牌/触发**：`jn_teahouse` action `[cmd:递话]`；giver `npcv_074`。
- **step 链**：
  1. 在 `jn_teahouse` 看他这三十回怎么传的话 → `flag hk_npcv_074_yajian_see`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那句话|替他把话断了>+karma:12;favor:npcv_074:40;flag:hk_npcv_074_yajian_stop;;替他继续传>+money:200;−karma:15;favor:npcv_074:20"`
- **奖励**：① `+exp 240 / +pot 60 / +karma 12 / favor npcv_074 +40`　② `+exp 150 / +money 200 / −karma 15`
- **秘密怎么演**：`secret`（雅间官粮凭据 + 偷换强秋的酒）**先露一半**：`say:「我传了三十回话，一两银子一回。这一回，我不想传了。」`
- **为什么做**：元若养了他十八年，**他却在替雅间数钱**——你想知道这个账他怎么算的。
- **主线关系**：**并行**（`jn_teahouse` 不在主线房间表）。
- **失败/放弃后世界状态**：可再接。

### Q42 `hk_npcv_074_qian` 「偷换的那坛酒」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_074":60}}`；`jn_teahouse` action `[cmd:找强秋]`。
- **step 链**：
  1. 在 `jn_teahouse` 找镖师 `npcv_081` 强秋（**同房**）问那趟误期的镖 → `flag hk_npcv_074_qian_ask`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那坛酒|替他还强秋一个说法>+karma:10;favor:npcv_081:40;flag:hk_npcv_074_qian_clear;;不问>favor:npcv_074:10"`
- **奖励**：① `+exp 260 / +pot 60 / +karma 10 / favor npcv_081 +40`　② `+exp 100 / favor npcv_074 +10`
- **秘密怎么演**：**完整揭开**：`say:「强秋那晚的酒，是我换的。他在门外站了半宿，我在屋里没敢开门。」`
- **为什么做**：强秋还在茶馆坐着等一个说法——**那坛酒的账，得有人替他还**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 强秋线了结（与保留像强秋联动）。

## V22 `npcv_252` 陈语冰（qinglou · `jn_brothel_room` 醉春楼·房）—— ⚠️ **主线占用**

> 主线三幕行前场用 `jn_brothel_room`（拉回#2）。故两条**错开时间窗**。

### Q43 `hk_npcv_252_minge` 「那个名额」
- **挂牌/触发**：`require:{not:{flag:"know_zhenyi"}}`（**三幕之前**）；`jn_brothel_room` action `[cmd:看名额]`。
- **step 链**：
  1. 去 `jn_brothel_hall` 找 `npcv_219` 梅拾（**异房**）问名额的事 → `flag hk_npcv_252_minge_ask`，`next:1`
  2. 回 `jn_brothel_room` → 抉择 → `next:99`
- **分支**：`menu:"那个名额|劝她让贤>+karma:15;favor:npcv_219:40;favor:npcv_252:-20;flag:hk_npcv_252_minge_yield;;替她争到>+money:200;−karma:15;favor:npcv_252:30"`
- **奖励**：① `+exp 240 / +pot 60 / +karma 15 / favor npcv_219 +40`　② `+exp 150 / +money 200 / −karma 15`
- **秘密怎么演**：`secret`（抄梅拾的秘密、烧了一半）**先垫**：`say:「梅拾教我认字那天，我记着呢。楼里就一个名额。」`
- **为什么做**：她最感激的人，和她抢同一条活路——**这条支线的戏在"她自己也难受"上**。
- **主线关系**：**三幕之前**（`require not know_zhenyi`），**避开主线行前场（同房）的时间窗**。
- **失败/放弃后世界状态**：可再接；选① → 梅拾脱籍（与保留像梅拾联动）。

### Q44 `hk_npcv_252_zi` 「枕下那个字」（reveal）
- **挂牌/触发**：`require:{and:[{flag:"know_zhenyi"},{flag:"hk_npcv_252_minge_yield"}]}`（**三幕之后**）；`jn_brothel_room` action `[cmd:问那本书]`。
- **step 链**：
  1. 她拿出枕下那张纸 → `flag hk_npcv_252_zi_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"枕下那个字|让梅拾知晓>+karma:5;favor:npcv_219:30;favor:npcv_252:-20;;什么都不说>favor:npcv_252:10"`
- **奖励**：① `+exp 220 / +karma 5 / favor npcv_219 +30`　② `+exp 100 / favor npcv_252 +10`
- **秘密怎么演**：**完整揭开**：`narrate:"她从枕下抽出一张纸，上面只有一个字，笔画歪歪扭扭——是梅拾教她写的头一个。"`
- **为什么做**：恨得越狠，那张纸越舍不得烧——**这就是她回头的路**。
- **主线关系**：三幕之后收尾。
- **失败/放弃后世界状态**：陈语冰可「转灰」。

## V23 `npcv_178` 钱疏（huashan · `huashan_shanxia` 华山脚下）

### Q45 `hk_npcv_178_fangzi` 「方子卖给谁了」
- **挂牌/触发**：`huashan_shanxia` action `[cmd:问她药]`；giver `npcv_178`。
- **step 链**：
  1. 在 `huashan_shanxia` 看那半张方子 → `flag hk_npcv_178_fangzi_see`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那半张方子|替她把方子收回来>+karma:15;favor:wen_huashan_shop:40;flag:hk_npcv_178_fangzi_back;;替她卖出去>+money:150;−karma:15;favor:npcv_178:20"`
- **奖励**：① `+exp 240 / +pot 60 / +karma 15 / favor 药婆婆 +40`　② `+exp 150 / +money 150 / −karma 15`
- **秘密怎么演**：`secret`（抄方、造谣）**先露一半**：`say:「山下的人，心比天冷。她不缺这点药。」`（说给自己听的托词）
- **为什么做**：救过她命的人，**被她卖了方子**——你想知道那张方子她到底还留不留得住。
- **主线关系**：**并行**。`huashan_shanxia` 不在主线房间表（主线三幕用 `huashan` 的房只有 `shaolin_cangjing` 相邻的 `hm_npcv_024`，不同房）。
- **失败/放弃后世界状态**：可再接。

### Q46 `hk_npcv_178_jiao` 「剩下的那半个角」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_178":60}}`；`huashan_shanxia` action `[cmd:问她那张纸]`。
- **step 链**：
  1. 她掏出只剩半个角的方子 → `flag hk_npcv_178_jiao_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那半个角|带她向药婆婆认错>+karma:12;favor:wen_huashan_shop:30;flag:hk_npcv_178_jiao_grey;;不问>favor:npcv_178:10"`
- **奖励**：① `+exp 260 / +pot 60 / +karma 12 / favor 药婆婆 +30`　② `+exp 100 / favor npcv_178 +10`
- **秘密怎么演**：**完整揭开**：`narrate:"她看了三年，撕了三年。剩下的那半个角，她一直没舍得撕。"`
- **为什么做**：一个造谣恩人的女人，**方子撕了三年没撕完**——那半个角就是她还认得住那份恩。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 钱疏「转灰」；药婆婆线闭环。

## V24 `npcv_095` 庞南枝（jiangnan · `jiangnan_temple` 城西破庙）

### Q47 `hk_npcv_095_qi` 「半张契」
- **挂牌/触发**：`jiangnan_temple` action `[cmd:看契]`；giver `npcv_095`。
- **step 链**：
  1. 去 `jn_yamen_arch`（衙门·架阁库）调那批旧档 → `flag hk_npcv_095_qi_arch`，`next:1`
  2. 回 `jiangnan_temple` → 抉择 → `next:99`
- **分支**：`menu:"那半张契|替她压下>−karma:15;flag:hk_npcv_095_qi_hide;;把旧档原样呈上>+rep:朝廷:20;flag:hk_npcv_095_qi_show"`
- **奖励**：① `+exp 240 / +pot 60 / −karma 15`（庙归道）　② `+exp 260 / +rep 朝廷 20`（触发「伪契」）
- **秘密怎么演**：`secret`（契上的年份是她添的）**由动作演出来**：`narrate:"她把那半张契举到日头底下——年份那两个字的墨色，比别处新。"`
- **为什么做**：一座破庙，两个出家人，斗了七年——**你想知道谁手里那张纸是真的**。
- **主线关系**：**并行**。`jiangnan_temple` 不在主线房间表（主线一幕江南舞台用 `road_jiangnan_1` 等，不同房）。
- **失败/放弃后世界状态**：可再接；选② → 「伪契」事件，庙产归僧。

### Q48 `hk_npcv_095_shifu` 「师父那句「莫争」」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_095":70}}`；`jiangnan_temple` action `[cmd:劝和]`。
- **step 链**：
  1. 在 `jiangnan_temple` 找 `npcv_027` 任停 / `npcv_029` 和青荷（**同房**）→ `flag hk_npcv_095_shifu_ask`，`next:1`
  2. 回庞南枝 → 抉择 → `next:99`
- **分支**：`menu:"七年了|替她与任停了断>+karma:12;flag:hk_npcv_095_shifu_end;;不问>favor:npcv_095:10"`
- **奖励**：① `+exp 280 / +pot 70 / +karma 12`（二人 mood +30，庙产两分）　② `+exp 100 / favor npcv_095 +10`
- **秘密怎么演**：**完整揭开**：`say:「我师父临走说，莫把心思用在争上。我争了七年，一次没下过狠手——我知道为什么。」`
- **为什么做**：她七年没下过狠手——**那半张假契让她心虚，也让她没变成另一个岳不群**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 庙产两分（世界状态），庞南枝与任停关系翻转。

## V25 `npcv_036` 鲁拂衣（shuyuan · `jn_study_1` 翰墨斋·后堂）

### Q49 `hk_npcv_036_juanzi` 「樊湘那一页」
- **挂牌/触发**：`jn_study_1` action `[cmd:看考卷]`；giver `npcv_036`。
- **step 链**：
  1. 在 `jn_study_1` 找同窗 `npcv_234` 樊湘 / `npcv_168` 岑元（**同房**）问落第的事 → `flag hk_npcv_036_juanzi_ask`，`next:1`
  2. 回鲁拂衣 → 抉择 → `next:99`
- **分支**：`menu:"那一页考卷|替她还回去>+karma:15;favor:npcv_234:40;flag:hk_npcv_036_juanzi_back;;替她压下>+rep:*:10;−karma:15;favor:npcv_036:20"`
- **奖励**：① `+exp 240 / +pot 60 / +karma 15 / favor npcv_234 +40`（樊湘翻案）　② `+exp 150 / +rep * 10 / −karma 15`
- **秘密怎么演**：`secret`（藏考卷）**先垫**：`say:「读书人的事，算不得手段。」`（她的自欺）
- **为什么做**：一个把"仁义"念成刀子的人——**你想看她怎么给自己找台阶**。
- **主线关系**：**并行**。`jn_study_1` 不在主线房间表（主线三幕用 `shaolin_daxiong` 等，不同房）。
- **失败/放弃后世界状态**：可再接；选① → 樊湘翻案（与 C 层 npcv_234 联动）。

### Q50 `hk_npcv_036_kai` 「书里夹着的那页纸」（reveal）
- **挂牌/触发**：`require:{favor:{"npcv_036":65}}`；`jn_study_1` action `[cmd:问那本书]`。
- **step 链**：
  1. 她自己翻出夹着的那页纸 → `flag hk_npcv_036_kai_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"那页纸|助樊湘翻落第>+karma:12;favor:npcv_234:40;favor:npcv_036:-30;flag:hk_npcv_036_kai_grey;;不问>favor:npcv_036:10"`
- **奖励**：① `+exp 260 / +karma 12 / favor npcv_234 +40`　② `+exp 100 / favor npcv_036 +10`
- **秘密怎么演**：**完整揭开**：`narrate:"她抽出一本书，翻到某一页——里面夹着的，是樊湘那一页考卷。"` `say:「我自认清高。这页纸，我一直不敢翻这本。」`
- **为什么做**：她抱起收留的小童阿宝时心是软的——**那点软就是她的拉回口**。
- **主线关系**：幕间补充。
- **失败/放弃后世界状态**：选① → 鲁拂衣「转灰」，书院乡试名额重新分配。

## V26 `npcv_082` 夏承志（palace · `palace_prison` 皇城·天牢）—— ⚠️ **主线占用**

> 主线五幕**拉回#7** 在 `palace_prison`（替他瞒 → 天牢门禁 + `palace_token`）。故两条**错开时间窗**。

### Q51 `hk_npcv_082_mibao` 「埋在院里那份副本」
- **挂牌/触发**：`require:{not:{flag:"know_depot_master"}}`（**五幕之前**）；`palace_prison` action `[cmd:问旧仆]`。
- **step 链**：
  1. 去 `jn_yamen_court`（衙门·大堂）见 `npcv_149` 元怀瑾 → `flag hk_npcv_082_mibao_yuan`，`next:1`
  2. 回 `palace_prison` → 抉择 → `next:99`
- **分支**：`menu:"院里那份副本|替他收好>favor:npcv_082:40;flag:hk_npcv_082_mibao_keep;;交给东厂>+rep:朝廷:20;favor:npcv_149:-50;flag:hk_npcv_082_mibao_give"`
- **奖励**：① `+exp 260 / +pot 70 / favor npcv_082 +40`　② `+exp 200 / +rep 朝廷 20`
- **秘密怎么演**：`secret`（三回密报 / 副本）**先露一半**：`narrate:"他领你到院角，蹲下来刨开一层土，露出一角油纸包。"` `say:「我每递一回，就埋一份。不是留证据——是留后路。」`
- **为什么做**：一个两头瞒的老仆——**他埋在土里的东西，就是他给自己留的回头路**。
- **主线关系**：**五幕之前**（`require not know_depot_master`），**避开主线五幕拉回（同房）的时间窗**。
- **失败/放弃后世界状态**：可再接；选② → 元怀瑾受查（世界状态）。

### Q52 `hk_npcv_082_hua` 「书房里那幅画」（reveal）
- **挂牌/触发**：`require:{flag:"know_depot_master"}`（**五幕之后**）；`palace_prison` action `[cmd:问那幅画]`。
- **step 链**：
  1. 他领你去看元怀瑾书房那幅画 → `flag hk_npcv_082_hua_seen`，`next:1`
  2. 抉择 → `next:99`
- **分支**：`menu:"书房里那幅画|助元怀瑾自清>+karma:15;favor:npcv_149:40;flag:hk_npcv_082_hua_clear;;不问>favor:npcv_082:10"`
- **奖励**：① `+exp 280 / +pot 70 / +karma 15 / favor npcv_149 +40`（开「旧仆」）　② `+exp 100 / favor npcv_082 +10`
- **秘密怎么演**：**完整揭开**：`say:「老爷书房那幅画，我理了三十年，一次没敢多看。可那幅画的事，是我写进去的。」`
- **为什么做**：他把这辈子的忠心和这辈子的背叛，**都挂在同一幅画上**。
- **主线关系**：**五幕之后收尾**，与主线不同时刻。
- **失败/放弃后世界状态**：选① → 元怀瑾自清，夏承志「转灰」。

---

## 11. 【V18–V26】模板任务替换清单（B20 处置）

| # | NPC | 被替换的模板任务 | 取代它的新支线 |
|---|---|---|---|
| 18 | `npcv_164` 皮朝颜 | `sq_npcv_164` | `hk_npcv_164_yinzi`（四幕前）+ `hk_npcv_164_sirenzhang`（四幕后） |
| 19 | `npcv_186` 鲁半夏 | `sq_npcv_186` | `hk_npcv_186_zuihua`（四幕前）+ `hk_npcv_186_yao`（四幕后） |
| 20 | `npcv_090` 阮听 | `sq_npcv_090` | `hk_npcv_090_jieyao`（三幕后）+ `hk_npcv_090_meimei`（并行） |
| 21 | `npcv_074` 和归鸿 | `sq_npcv_074` | `hk_npcv_074_yajian` + `hk_npcv_074_qian` |
| 22 | `npcv_252` 陈语冰 | `sq_npcv_252` | `hk_npcv_252_minge`（三幕前）+ `hk_npcv_252_zi`（三幕后） |
| 23 | `npcv_178` 钱疏 | `sq_npcv_178` | `hk_npcv_178_fangzi` + `hk_npcv_178_jiao` |
| 24 | `npcv_095` 庞南枝 | `sq_npcv_095` | `hk_npcv_095_qi` + `hk_npcv_095_shifu` |
| 25 | `npcv_036` 鲁拂衣 | `sq_npcv_036` | `hk_npcv_036_juanzi` + `hk_npcv_036_kai` |
| 26 | `npcv_082` 夏承志 | `sq_npcv_082` | `hk_npcv_082_mibao`（五幕前）+ `hk_npcv_082_hua`（五幕后） |

**清单条数：9**（第三批）；**三批合计 26 条**（＝ A 层 26 位 NPC 全覆盖）。

---

## 12. id 自查（三批合计 · 脚本）

> 脚本：抽本文全部反引号候选 id，对照 `rooms/npcs` + `20_items` + `10_skills` + `60_quests` + `portraits-new.json`。

| 类别 | 数量 |
|---|---|
| **候选 id（含下划线）** | **322** |
| ① **真实命中** | **180**（room 50 · npc 49 · item 3 · quest 26 · **画像 hook 52**） |
| ② **新增** | **137**（含 3 房间 + 5 物品 + 1 新增 NPC + 1 提议 var `favor_npcv_208` + `hk_` 系列） |
| ③ 主线 id（`design/21` 已定义：`know_zhenyi`/`know_depot_master`/`yu_ledger`/`yue_zhi_road`/`ruan_cure`） | **5** |
| ④ **编造** | **0** ✅ |

> 复核：180 + 137 + 5 = **322**，与候选总数**吻合**。
> 支线总数 **52 条**（26 位 NPC × 2 hook，与 `portraits-new.json` 的 52 个 hook **一一对应**）。

---

## 13. 与主线冲突核对（三批汇总）

| 批次 | 涉及 NPC | 主线占用 | 处理 |
|---|---|---|---|
| 一（V01–V09） | 9 人 | **0 人** | 房间表交集为空 → 零冲突 |
| 二（V10–V17） | 8 人 | 2 人：`npcv_248` / `npcv_180` | 全部用 `require` 前/后时间窗错开（见 §10） |
| 三（V18–V26） | 9 人 | 5 人：`npcv_164` / `npcv_186` / `npcv_090` / `npcv_252` / `npcv_082` | 全部用 `require` 前/后时间窗错开（见各条） |
| **合计** | **26 人** | **7 人**（＝ A 层 26 中全部被主线占用的） | **无一与主线同刻占同一 NPC / 同一场景** |

> **统一口径**：凡与主线**同房**的，一律用 `require` 把支线限制在主线**之前**或**之后**；凡**不同房**的，并列即可。
> **0 条支线设为主线硬前置**（避免卡主线）。

---

## 14. 待工程实测清单（不阻塞设计，落地前逐条确认）

| # | 悬置点 | 我的替代方案（若不可行） |
|---|---|---|
| 1 | `require` 的 `favor` 型条件键名（`require:{favor:{"npcv_208":30}}`） | 改为 `{var:"favor_npcv_208",op:">=",value:30}` 形式 |
| 2 | `menu` 单个选项**能否挂 `cond`**（如 Q06「凭名声」需 `rep>=30`） | 改为**选项内 effect 自判**（不满足则 `say` 一句打发） |
| 3 | `jn_silk_shop` **一脚踏两船**（Q01/Q17 同房两入口） | Q17 改在 `jn_market_north` 就地"看货" |
| 4 | 房间 `actions` 承载量（market/各城将新增约 20 个入口） | 合并同房入口为子菜单（`menu`） |
| 5 | 新增 3 房间（`gusu_fengqiao`/`jn_granary`/`jn_yizhuang`）的**严格反向边** | 若暂时不建，Q13/Q15/Q22 改用相邻既有房 + `narrate` 交代 |
