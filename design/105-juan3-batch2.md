# 105 · 卷三第二批施工单（游有方，2026-10-18）

> 承接 97 §九.4 #5。铁律照 102：入口指路 ≥1 处｜散人双通道自查｜朱雀 ≤10｜
> 收束 stage.lock 按卷界前置（本批=know_zhenyi）不并主线 rewards｜幂等 apply+独立 check。
> 落法：`tools/_apply_j3b_batch5.py`（两连跑幂等+断言）+ `tools/_j3b_batch5_check.js` 真走。

## 一、素材盘点（全部现成，零新人设）

| 资产 | 位置 | 状态 |
|---|---|---|
| 阮听 1-stage 壳（妹妹那碗药） | 61: hk_npcv_090_meimei，require `questDone: jieyao`（案2 已收束才可见） | 菜单双选（解蛊告知/瞒下）=收束菜单，照 67 款原 stage 后移 |
| 陈语冰 1-stage 壳（枕下那个字） | 61: hk_npcv_252_zi，require `questDone: minge`（案1 已收束才可见） | 菜单双选（让梅拾知晓/瞒下）=收束菜单，同款后移 |
| 血刀线埋件 | 案4「哨卡的规矩」收口 **bj_manifest**（半页运单，收件人=hm_blood_saber 人手房名单）；主线 pass_shankou 软咬合 | 102 §五已落 |
| 西夏线证据 | **snow_evidence_xixia**（俞初案 s3 已落 setter） | 102 §四已落 |
| 星宿线取证 | 主线 s5 or[zhenyi_bait, poisoned_xingxiu, refuse_fake]；ruan_cure（问解药戏分支）已有 setter | 65 已落 |
| 咬合房 | gusu_yanzi（燕子坞，仅「探索」动作）/ xiyu_herb_hut（药庐）/ xiyu_bazaar（巴扎，无动作）/ beijiang_shankou（雪谷山口，无动作）/ road_xixia_1（西夏官道） | 均在 50_map |
| 「问抄纸/问解药」现成戏 | 65: jn_brothel_room / jn_fruit_stall | 不动，新动作 keywords 全避让 |

## 二、案 A · 星宿侧「妹妹那碗药」（4 stage，S3 改造）

**一句话**：解药递到了，妹妹腕上那道蛊还在——解药方子要蛊主一滴血，妹妹自己说：别让我回去。

| stage | 场景 | 内容 | flag/出口 |
|---|---|---|---|
| 0 接案（新写） | jn_fruit_stall | 阮听说妹妹的药钱：姑苏燕子坞有位毛郎中，收得住星宿海的毒 | target jn_fruit_stall |
| 1 燕子坞问诊 | gusu_yanzi | 房动作「问诊」：毛清辨验出毒不是病是蛊——解方在星宿海那间药庐，上回有人问过（咬合 ruan_formula_known 事实） | meimi_poison_known |
| 2 药庐翻册 | xiyu_herb_hut | 房动作「翻试方册」：妹妹的试方册，一笔一笔记着试过什么；末页一句「哥若来，别让我回去」 | meimi_note_read |
| 3 收束（原壳原样后移） | jn_fruit_stall | 原 say（不会死的毒）+narrate（掌心旧疤）+原菜单双选（解蛊并告知真相/瞒下）**逐字不动**，加 `lock know_zhenyi` | next 99 |

- 双通道：全案无门派依赖（散人铁律自查 ✓，两条通路都不查门派）。
- 指路：①燕子坞「问诊」常驻动作=入口；②s0 接案戏点破「姑苏燕子坞毛郎中」（接案即指路）。
- rewards：原菜单值 verbatim 留在收束菜单；新 stage 零 rewards（不并主线）。

## 三、案 B · 西域侧「枕下那个字」（4 stage，S3 改造）

**一句话**：枕下那个字不是恨，是她自己的姓——疏勒的旧货单上，她连名字都没有，只有一个价。

| stage | 场景 | 内容 | flag/出口 |
|---|---|---|---|
| 0 接案（新写） | jn_brothel_room | 抄本线收束后的余波：她枕下压着一张纸，压了很久 | target jn_brothel_room |
| 1 看枕下 | jn_brothel_room | 房动作「看枕下」：那个字是她自己姓——牙婆的船上她没有名字，只有一个价 | zi_name_known |
| 2 疏勒旧货单 | xiyu_bazaar | 房动作「翻旧货单」：三年前货单上南边楼里收的「货」无名只记斤两——**与 bj_manifest 运单同款笔法**（咬合批5-3） | zi_ledger_seen |
| 3 收束（原壳原样后移） | jn_brothel_room | 原 narrate（梅拾教的头一个字）+say（恨得越狠越舍不得烧）+原菜单双选**逐字不动**，加 `lock know_zhenyi` | next 99 |

- 双通道：全案无门派依赖 ✓。
- 指路：①雅阁「看枕下」动作 cond questDone minge=入口；②巴扎「翻旧货单」cond quest 进行中=中转钩子。
- rewards：原菜单值 verbatim；新 stage 零 rewards。

## 四、件② 浮名回报件（act3_mole_trail，road_xixia_1 俞初处）

**定位**：三线取证交差后的浮名结算戏——「北边三条道上的事，在茶馆里拼成了一件事」。

- 载体：road_xixia_1 房动作「对三线的账」，cmd 对账，keywords [对账, 三线的账]（避开既有词）；
- cond：`or[snow_evidence_xixia, bj_manifest, ruan_cure, poisoned_xingxiu, refuse_fake]` + `notFlag act3_mole_named` + `notFlag act3_mole_withheld`——**任意一线交差都有去向**（与主线 s3 or[] 判式同源扩集）；
- effects：narrate×2（俞初把三线的账并排摆开）+ menu 双选：
  - **照实说** → `flag act3_mole_named` + `+rep:朝廷:20`（浮名入档：朝廷记下这双眼睛）；
  - **留一手** → `flag act3_mole_withheld`（半交浮名：没交的那几线，江湖风评里多一条没头没尾的话；**半交结局的浮名处置**=不入朝廷账，风声档承接）；
- 机制记档：判定接线（半交结局读 act3_mole_named/withheld）归寇豆码 lane，与 102 §四先例同款；rumor 种子可选后续（rs_mole_named，本批不落，engine note 点位留待）。

## 五、件③ 哨卡验牌接引场（beijiang_shankou）

- 载体：雪谷山口房动作「递牌过哨」，cond `or[bj_manifest, pass_shankou]` + `notFlag shankou_card_seen`；
- effects：narrate×2 + say 兵一句——兵照往来簿对名头：运单上的收件人、簿上都有；「单子上的货，卡上的人，早有人对过账了」；接引句「打这往上，道认牌不认人。有人先你一步，把你的名字递上去了」——接引卷四黑木崖线（hm_blood_saber 人手房名头已通）；
- flag `shankou_card_seen`（纯接引场，零 rewards，不并主线）；
- 与件②咬合：shankou_card_seen 可并入件② cond 扩集（验牌也是「交差」的一种），本批落为独立 flag，扩集留给判定侧。

## 六、验收（每案固定栏）

1. 两案全 stage 真走通（造玩家、置 act2_done+jieyao/minge questDone，逐 stage exec，menuPick 真选收束菜单，断言原菜单逐字保留）。
2. 原壳 s0 快照逐字核对（say/narrate/menu raw）。
3. 收束 lock=know_zhenyi、next=99、新 stage 零 rewards。
4. 指路动作真触发 + keywords 全库不撞（含「问抄纸/问解药/拍卖」既有动作）。
5. 件②③动作真触发：置线 flag → narrate → menuPick → 断言 flag/rep。
6. 朱雀 per-asset ≤10（两案+两间房复验）＋ ai-flavor ＋ map-check ＋ smoke-sidequest 不回归。

## 七、风险与可砍项

| # | 风险 | 处置 |
|---|---|---|
| 1 | 案 A s0 与「问解药」戏同房，撞词/撞戏 | 新动作 keywords 避让已核（问解药/解药/问箱子/问阮听全避开）；接案走任务列表不走房动作 |
| 2 | 主线血刀/星宿 flag 无 setter（xuedao_copy 等） | 判定接线归寇豆码（102 §四先例）；件② cond 用 ruan_cure/bj_manifest 等已有 setter 的旗子兜底 |
| 3 | 半交结局判定依赖 act3_mole_named/withheld 接线 | 数据侧先落 flag；接线列入引擎 lane 追加件 |
| 4 | 两案都是收束后余波，戏力偏静 | 静收束是本批定位（卷终余响），爆点留给批 6 卷四 |

## 八、落地记档（2026-10-18 收官，游有方）

**批次状态：绿。** 两连跑幂等；两案真走 34/0；件②③真走 21/0；朱雀 0 条 >10；ai-flavor 0；map-check 6484/0；smoke-sidequest 57/0；quest-sanity 30/0；check-data-load 76/0。

| 件 | 载体（分片） | cmd / keywords | cond 口径 | flag / 结算 |
|---|---|---|---|---|
| 案A 妹妹那碗药 | 61（4-stage） | 接案「问妹妹」 | `and[not quest, questDone jieyao]`（本轮补） | meimi_poison_known / meimi_note_read / 原菜单 flag |
| 案B 枕下那个字 | 61（4-stage） | 接案「问那本书」 | `and[not quest, questDone minge]`（本轮补） | zi_name_known / zi_ledger_seen / 原菜单 flag |
| 指路（50） | gusu_yanzi / xiyu_herb_hut / xiyu_bazaar | 问诊 / 翻试方册 / 翻旧货单 | `{"quest": qid}` | 三 flag 同 stage 落点（双入口取一即得） |
| 指路（65） | jn_brothel_room | 掀枕下（原「看枕下」改词） | `{"quest": hk_npcv_252_zi}` | zi_name_known |
| 件② 对三线的账 | 65 · road_xixia_1 | 对账 / ['对账','三线的账','对一遍账'] | `and[or(snow_evidence_xixia,bj_manifest,ruan_cure,poisoned_xingxiu,refuse_fake), notFlag act3_mole_named, notFlag act3_mole_withheld]` | 照实说 → act3_mole_named + `+rep:朝廷:20`；留一手 → act3_mole_withheld（不入朝廷账） |
| 件③ 递牌过哨 | 65 · beijiang_shankou | 递牌 / ['递牌','验牌','过哨'] | `and[or(bj_manifest,pass_shankou), notFlag shankou_card_seen]` | shankou_card_seen（零 rewards） |

**两条踩坑记档（防复发）**
1. **挂房动作必须挂「最后定义该房且带 actions 键」的分片**。实测：`jn_brothel_room` 挂 50_map 被 65 的 actions 整条顶掉（数组后载胜）→ 引擎里动作不存在，输入落到内置 look，按钮变死键。反例校正：`road_xixia_1` 虽在 73 也有 rooms 块，但**没有 actions 键**，故 65 的「截信」与本次「对账」都安全。
2. 「cmd 以内置主词开头会被吞」**已实测推翻**（看当铺告帖/看行情帖/看经架/看车辙 均命中房动作）。案B 改词用「掀枕下」只为更贴动作本身，不是回避内置词。

**留给引擎 lane 的接线件（数据侧已就位，勿重复落数据）**
1. 半交结局读 `act3_mole_withheld` 的浮名处置（风声档承接；本批只落 flag，不入朝廷账）。
2. `shankou_card_seen` 并入件② cond 扩集的判定侧（验牌也算一种「交差」）；本批按 105 §五 保持独立 flag。
3. 可选 rumor 种子 `rs_mole_named`（本批不落，engine note 点位留待）。
