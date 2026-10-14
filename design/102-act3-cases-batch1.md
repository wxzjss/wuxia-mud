# 102 · 卷三第一批 4 案施工单（S3 范式，发版门槛件）

> 游有方，2026-10-14。承接 97 §九.4 #2 批 / 100 §二。**发版门槛：陈语冰/阮听两收束件必须在。**
> 铁律：每案入口指路 ≥1 处｜散人双通道自查｜朱雀 ≤10（_zhuque_per_asset.py）｜know_zhenyi 前置**不并主线 rewards**（89 §三/§五：半交结局=chen_chaoben 在手）。
> 落法：新建 `tools/_apply_act3_cases.py`（模式照 _apply_act3_map.py：两连跑幂等+断言钉死）；61 池壳改造在 61_sidequests.json 原位，新增 NPC/房/动作走 65_mainline_act3.json 深合并。

## 一、素材盘点（全部现成，零新人设）

| 资产 | 位置 | 状态 |
|---|---|---|
| 陈语冰 1-stage 池壳（那个名额） | 61: hk_npcv_252_minge | 菜单双选（让贤/争到），require `not know_zhenyi` **保留** |
| 「问抄纸」现成戏 | 65: jn_brothel_room | snow_lead 门，chen_chaoben（抄本+半交 flag）/252_broken 双分支，含「疏勒镇往黑水的道，装货的姓常」指路 |
| 阮听 1-stage 池壳（丁春秋的解药） | 61: hk_npcv_090_jieyao | 菜单双选（跑星宿海/劝离开） |
| 「问解药」现成戏 | 65: jn_fruit_stall | snow_lead 门，ruan_cure+star_cure_item/npv090_broken 双分支，含「替我带句话给疏勒镇的货郎，瓶子满了」指路 |
| 俞初两连池壳 | 61: hk_npcv_248_jiushui + _changfu | 冰窖假账（xixia_ice）+常拂（road_xixia_1），require 链已接 |
| 主线取证缺口 | 65: q_main_snow | 血刀线 flag=xuedao_copy、星宿线 flag=poisoned_xingxiu/refuse_fake 都在；**西夏线取证 flag=0 条**——俞初案就是西夏线 |
| 地标房锚点（批 2 刚落） | 50_map | xixia_market/xixia_post/xixia_salt_shed（俞初）、xiyu_herb_hut/xiyu_bazaar（阮听）、beijiang_market/beijiang_lookout（北疆案）——12 间全过 BFS 可达 |

## 二、案 1 · 陈语冰「那个名额」（5 stage，收束件·发版门槛）

**一句话**：一个脱籍名额牵出三年前一笔捐银——银子从西夏盐场来，从哪来，字就在谁的枕下。

| stage | 场景（room） | 内容 | flag/出口 |
|---|---|---|---|
| 0 接案（池壳原 stage） | jn_brothel_hall | 问梅拾名额的事（现菜单保留：让贤/争到） | hk_npcv_252_minge_yield / _win |
| 1 名额从哪来 | jn_brothel_hall | 追问老鸨：名额是捐的，捐银的户头写的是盐号——跟西夏盐册对得上（咬合 xixia_yanchang 盐册文本） | salt_link_seen |
| 2 枕下那个字 | jn_brothel_room | 接「问抄纸」现成戏（snow_lead 门内）：等她唱完→抄的是书→**chen_chaoben 双分支不动** | chen_chaoben / 252_broken |
| 3 疏勒对货 | xiyu_bazaar（巴扎·疏勒） | 装货的姓常、脸上有块疤——在巴扎找到常家货栈，抄本走哪条道见分晓 | cha_route_known |
| 4 卷终抉择（know_zhenyi 前置） | jn_brothel_hall | 交不交抄本：交东厂（rep:朝廷+30，chen_chaoben 失）/留在手上（**半交结局前置，无 rewards**） | chen_chaoben 保留 |
- **双通道**：门派弟子→门内文书查捐户名册（stage 1 走快路，免 200 钱）；散人→醉春楼妈妈的账本（给老鸨 favor 或钱）。
- **指路**：①西夏盐场（xixia_yanchang 盐册 action 尾补一句「这户三年前还捐过南边一座楼里的名额」）拉回江南；②兴庆集市（xixia_market talk[0] 换血）提醉春楼名额。
- **声望挂点**：rep:朝廷（交抄本线）/favor:npcv_252 梅拾 ncv_219 陈语冰（池壳现值保留）。
- **不并主线 rewards**：stage 4 挂 require know_zhenyi，纯收束演出。

## 三、案 2 · 阮听「丁春秋的解药」（5 stage，收束件·发版门槛）

**一句话**：解蛊的药方在星宿海，妹妹的那碗药是七年前的旧账——药递到手上那天，才轮到他选。

| stage | 场景（room） | 内容 | flag/出口 |
|---|---|---|---|
| 0 接案（池壳原 stage） | jn_fruit_stall | 听他讲蛊发（现菜单保留：跑星宿海/劝离开） | hk_gu / _leave |
| 1 妹妹那碗药 | jn_fruit_stall | 追问腕子上的旧疤：他妹妹当年病重，丁春秋那碗「药」救了命也种了蛊——妹妹现在星宿海「替他试新方子」（咬合 xiyu_herb_hut 药庐 talk[1] 现成句「上回问的人，现在还在星宿海里替我试新方子」） | ruan_sister_known |
| 2 星宿取药解 | xiyu_herb_hut（星宿海·药庐） | 药庐问方：药引要「蛊主本人的一滴血」——要解药就得再进星宿海 | ruan_formula_known |
| 3 带话（现成戏接线） | jn_fruit_stall | 接「问解药」snow_lead 门内戏：纸包三层、含在舌下、「瓶子满了」——**ruan_cure+star_cure_item 双分支不动** | ruan_cure / npv090_broken |
| 4 交与不交（know_zhenyi 前置） | xiyu_herb_hut | 把解药交阮听（断蛊=他和妹妹都欠丁春秋一条命，得跑）/交回药庐（换妹妹出来，他留下） | ruan_free / ruan_stay |
- **双通道**：门派弟子→星宿海有同门内应（stage 2 免毒气检定）；散人→pxixia_pass 贺兰隘口找私贩带路（花钱+风险句）。
- **指路**：①药庐 talk[1] 现成句就是钩子（无需新写）；②巴扎 talk[1]「星宿海的人也来赶集」尾部补「有个卖果子的南边人托过话」拉回江南。
- **声望挂点**：rep:星宿海（交回药庐线）/favor:npcv_090。
- **不并主线 rewards**：同案 1。

## 四、案 3 · 俞初「西夏官道」（两连池壳深改造，4 stage）

**一句话**：冰窖那页假账只是头——盐册、截信、对账三件对齐，西夏这条取证线才算齐。

| stage | 场景（room） | 内容 | flag/出口 |
|---|---|---|---|
| 0 冰窖假账（jiushui 原壳） | xixia_ice | 抽三年前那页（菜单保留：留抄本/当面烧） | _copy / _burn |
| 1 盐册对页 | xixia_yanchang（盐池·工棚） | 假账的户头在盐册上对出一笔平账——钱进了哪个盐号（咬合工棚 talk[0] 现成句「账上多出来的，谁也不敢问」） | xixia_salt_ledger |
| 2 官道截信 | road_xixia_1 / xixia_post（兴庆驿） | 兴庆驿按牌传信——截下盐号往黑水的信（驿卒 talk[1] 现成句「渡口的船认驿牌」反着用：信走船） | xixia_intercept |
| 3 对账收口（changfu 原壳并入） | road_xixia_1 | 常拂的账跟俞初的页拼上——**西夏线取证 flag 落定** | snow_evidence_xixia |
- **喂主线**：snow_evidence_xixia 进 q_main_snow 证据判定（三线：xuedao_copy + poisoned_xingxiu/refuse_fake + snow_evidence_xixia）——**引擎判定侧挂 flag 的接线归寇豆码**，我落数据+施工图。
- **双通道**：门内文书过盐场（89 §三卷三·身份原案）；散人→工棚「等管事骂完人」（talk[1] 现成句）混进去抄页。
- **指路**：①xixia_post 驿卒 talk 尾补「三年前有一页账，驿里没人敢送」；②冰窖 failMsg 改「先去工棚问盐册」（池壳 failMsg 现为空）。
- **声望挂点**：rep:朝廷（jiushui 原值保留）/favor:npcv_248。

## 五、案 4 · 北疆血刀侧「哨卡的规矩」（新写，4 stage）

**定稿二选一：新写**（池件改造无从选——61 池北疆件 0 条）。挂在冻市+望雪台+雪谷哨卡一线。

**一句话**：冻市的铁器卖得比官价贱，哨卡的兵验的不是过所——血刀门在北疆替人运什么，摸一次哨就清楚。

| stage | 场景（room） | 内容 | flag/出口 |
|---|---|---|---|
| 0 接案 | beijiang_market（冻市） | 铁器摊主（talk[1] 现成句「出了这个市，血刀门的规矩就是规矩了」为钩）拜托：他儿子被拉去雪谷哨卡当差，三个月没信 | bj_son_worried |
| 1 摸哨 | beijiang_lookout（望雪台） | 台上数布条（talk[0] 现成句「数得过来的都回来了」）——夜里看哨卡换防：新兵里认出摊主儿子的弓 | bj_spot_son |
| 2 走一趟雪谷 | beijiang_shankou（雪谷山口） | 借送冬衣进哨（pass_shankou 主线 flag 若在=免战；否则花钱/打架双通道） | bj_met_son |
| 3 收口 | beijiang_market | 儿子托带的不是家书，是半页运单——血刀门替人往里运的东西见字（咬合 hm_blood_saber 人手房：运单上的收件人就是人手房名单） | bj_manifest |
- **双通道**：门派弟子→血刀门 align 正/邪过法不同（正派亮腰牌送衣免检；邪派直接找血刀门人打招呼）；散人→冻市烈酒摊买「通路」。
- **指路**：冻市 talk[0]「酒是热的」句后补摊主拜托（stage 0 入口即指路）；望雪台 stage 1 动作 cmd=数布条（talk 呼应）。
- **声望挂点**：rep:血刀门（通融线）/favor 铁器摊主（新 NPC，def 落 40_npcs 深合并，room=beijiang_market，noWander:true）。
- **喂主线**：bj_manifest 是血刀线的旁证（xuedao_copy 之外的「人手房名单」对账件）——软咬合，不锁 Boss 战。

## 六、验收（每案固定栏）

1. 接案→收口全 stage 真走通（模式照 _act1_walkthrough：造玩家、置 snow_lead、逐 stage exec）。
2. 入口指路 ≥1 处——每案「站在接案房，怎么知道有这事」自查栏。
3. 散人双通道：散人玩家（无门派）逐案走一遍，每案至少一条无门派依赖的通路。
4. know_zhenyi 前置收口不并主线 rewards（陈语冰/阮听）。
5. 朱雀 per-asset ≤10：新增 quest 资产过检（菜单 raw 按句子拆算）。
6. 守卫连带：data-load/actions-check/say-hint（新动作登记施工图）/smoke-mainline35（q_main_snow 证据 flag 接线后复跑）。

## 七、风险与可砍项

| # | 风险 | 处置 |
|---|---|---|
| 1 | 4 案同窗撞工 | 俞初/北疆两案可后于门槛件半批（100 §三：发版门槛只卡陈语冰/阮听） |
| 2 | snow_evidence_xixia 判定接线依赖寇豆码 | 数据侧先落 flag；判定接线列入 #65 引擎 lane 追加件，已报 |
| 3 | 新 NPC（铁器摊主）撞 40_npcs 现有 id | 落前查重 id 前缀 npc_bj_market_ |
| 4 | 菜单 raw 长句撞朱雀 burst | 写作时句长方差按 93 口径自查，交案过 per-asset |
