# 100 · 批 2 施工单：地图步 + 卷三第一批（同窗，验收门槛制）

> 游有方，2026-10-13。承接 97 §九 严苛玩家复审修正案（§九.4 #2 批）。
> 立案依据：主人令「卷三第一批 4 案提前与地图步同窗，作为地图步验收门槛」。
> 铁律（97 §九.5，全批适用）：①每新案 ≥1 处入口指路，否则验收红；②散人双通道自查固定栏；③朱雀 ≤10（tools/_zhuque_per_asset.py）交案必过。
> **验收总纲：地图步发版时卷三不能还是真空——验收不看门修没修，看门后有没有戏。**

## 一、地图步 9 项（分工：主程序 M / 游有方 Y）

| # | 项 | 内容 | 现状实测 | 分工 |
|---|---|---|---|---|
| 1 | F5-a 北路闸门 | road_nan_1.w 加 cond act2_done 门对象（93 口径：cond+say 拦人戏+msg 兜底+travel 放行） | 实测裸字符串→road_beijiang_1 | 门对象 M / 文案 Y |
| 2 | F5-b 西夏闸门 | road_gaibang_1.e 同上 | 实测裸字符串→road_xixia_1 | 同 |
| 3 | F5-c 荒原双闸 | road_many_1.e 与 .w **两向各配**（进/出文案不同：进是「买路的先说说价钱」式，出是「回望荒原」式） | 实测两向均裸字符串 | 同 |
| 4 | F5-d 金国废墟闸 | jinguo_ruin.n 同上 | 实测裸字符串 | 同 |
| 5 | F5-e 长安南闸 | changan_gate.s 同上 | 实测裸字符串 | 同 |
| 6 | F6-a 行路边改区 | luoyang↔mojiao 边（cond act2_done）**改挂 beijiang**——现边把卷二收束玩家直接送进黑木崖（卷四 Boss 区）；mojiao↔changan 维持 act3_done | 实测错区边仍在 | M |
| 7 | F6-b 三区入口修正 | regions.entry：beijiang 现挂 **beijiang_xuedao（血刀门大殿）**——行路进来=空降门派，改挂 road_beijiang_1；xiyu 的 xiyu_oasis / xixia 的 xixia_ice 核对落点是否官道/野店（非门派殿内）；**新增行路边 luoyang↔beijiang（cond act2_done，驿站渡口文案 Y 写，现三区行路边 0 条）** | 实测 entry 挂门派 + 0 行路边 | entry 改 M / 文案 Y |
| 8 | F7 废边删除 | jiangnan_east_road.s→mojiao_shanmen 遗产废边删除（黑木崖唯一入口=上崖路哨卡 cond act3_done）；连带改 smoke 判据（95 §七先例） | 实测废边仍在 | M |
| 9 | 三区地标密度 | 每区补 3-5 间功能房（驿站/野市/奇观，非门派房）：北疆（雪谷外围猎户冬屋/血刀山市集/哨卡房）、西域（疏勒巴扎/星宿海药庐/绿洲驿站）、西夏（盐场工棚/兴庆集市/贺兰山隘口）。**desc/talk 全新写（Y），挂房+出口接线（M）** | 实测三区 7-10 间全是门派+vault 骨架，零生活房 | desc Y / 接线 M |

## 二、卷三第一批 4 案（S3 范式，全 Y lane）

范式卡（照 69 片 S3 六案）：池件深改造（1 stage 壳 → 3-5 stage 完整案）+ 联动收口 + 声望挂点 + 门派/散人双通道。

| 案 | 池件 | 改造要点 | 收束挂点 |
|---|---|---|---|
| 陈语冰·那个名额 | hk_npcv_252_minge「那个名额」（1 stage） | 扩成完整案：名额从哪来→枕下那个字→卷终抉择；入口落西夏/兴庆，与主线 q_main_snow 三线取证咬合 | **know_zhenyi 前置（半交结局前置，97 §七.5 定案），不并主线 rewards**；require 现值 `not know_zhenyi` 保留 |
| 阮听·解药线 | hk_npcv_090_jieyao「丁春秋的解药」（1 stage，无 require） | 扩成完整案：妹妹那碗药→星宿海取药解→交与不交的抉择；入口落星宿侧（xiyu 区新地标房） | know_zhenyi 前置，同上 |
| 俞初·西夏官道 | 61 池西夏官道件（施工时按 giver 名核对 id） | 三线取证的「西夏线」：盐册（xixia_yanchang 现成文本咬合）→官道截信→对账 | 喂 q_main_snow 取证链 |
| 北疆血刀侧 1 案 | 池件改造 or 新写 1 案（哨卡摸哨联动） | 血刀门市集/哨卡背景，与人手房 hm_blood_saber 咬合；**施工单批前定稿二选一** | 卷三腹地密度 |

每案施工单（批内细化）：入口指路 ≥1 处（NPC 对话锚/房间动作/追踪 hint）｜散人可走自查（89 §四）｜声望挂点｜朱雀 ≤10。

## 三、顺序与门槛

1. 闸门/行路/废边（项 1-8）先行——但**发版门槛**：项 9 与 4 案至少各完成一半（陈语冰/阮听两收束件必须在），否则地图步不发版。
2. 全部走幂等 apply 脚本（_apply_act3_map.py 新建，模式照 _apply_act1_map.py：两连跑幂等+断言钉死）。
3. 判据连带：闸门文案过 say-hint 施工图登记、smoke-guards 全分片合并口径、F7 删边的 smoke-act2 判据同步改（95 §七先例）。

## 四、风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | 同窗拉长工期 | 4 案全是池件深改造（S3 范式零新人设），与地图 9 项机械活并行不冲突；宁可晚三天，不可门后真空（97 §九.6） |
| 2 | F6 entry 改挂牵动 travel 判据 | mapguide-check/map-edge-check 同步改，记档 |
| 3 | 闸门文案 6+ 处批量产出撞 AI 腔 | 交案过朱雀 ≤10；93 口径 say 保戏、msg 兜底，白名单口径只认设计性复用 |

## 五、批 2 data 侧落盘记（2026-10-14，游有方）

**_apply_act3_map.py 两连跑幂等全绿；tools/_act3_map_check.js 引擎合并层终验 26/0。**

落盘内容：F5 六闸门（cond act2_done，93 口径三件套）/ F6-a luoyang↔beijiang 边改挂 / F6-b 双向行路边（老船工，93 §二复用）/ F6-c regions.entry beijiang→road_beijiang_1 / F7 废边双侧删净 / 12 间地标房（北疆 4+西域 4+西夏 4，朱雀 composite 0-1）/ 回边（kunlun_gate 等非 50_map 房落 104 深合并）。

**施工单外逮出三个存量窟窿，同批修掉（判据连带记档）**：

| 补项 | 病灶 | 修法 |
|---|---|---|
| F7-n | 废边只删了 s 侧，`mojiao_shanmen.n→jiangnan_east_road` 对向残留=下山捷径绕开山道；adjacency B 断头线 1 条 | n 侧同删；黑木崖出入=行路（mojiao↔changan, act3_done）+88 山道。B 断头线 1→0 |
| F8 | `road_xiyu_1.s→road_xixia_1` 有去无回：从西夏官道走不到西域官道，荒原双闸（many_1 两向）整簇锁死在不可达侧 | 补 `road_xixia_1.sw→road_xiyu_1`。⚠ 方向键 nw/ne 被 73_sects_place 门锚点（baituo/kunlun）后载覆盖动不得，四正向也全占，用 sw。首版误写 nw 已幂等清理 |
| F9 | `xiyu_shule.s→xiyu_oasis` 有去无回，疏勒=死区——60_quests「去西域·疏勒镇找着欠债的丁春秋」与 65_mainline_act3 疏勒 stage 一直踩不进 | 补绿洲 sw↔疏勒 ne 对边（legacy s 边不动）；疏勒巴扎随之可达 |

⚠ 分片序坑（「不报错就是不生效」族新证）：**regions.entry 全库只声明在 50_map.json 的 regions 块**（不在 70_world——引擎三处消费：engine.js:1470 大地图回落 / commands.js:4994 行路落点 / maplayout.js:345 布局起点）；exits 同名键**后载分片胜**（73/82 覆盖 50），改边先查全分片占键。

守卫复验（2026-10-14 当日）：data-load 61/0 · actions 9/0 · say-hint 15/0 · act1 走通 77/0 · 第一分钟 21/0 · smoke-act2 143/0 · demo-mods 9/0 · mapguide 89/0 · 朱雀 per-asset 全量 0 超线（12 新房 composite 0-1）· smoke-mainline35 135/1（唯一红=taixu_hermit 已知绊线，M68 示例 mod 默认关的连带，脚本头注释在案，归寇豆码/lead 处置，非批 2 引入）。

### §五-bis 扫尾④：F8/F9 撤销 + 七回边对称自愈（2026-10-15，游有方）

**发布窗 map-check 7 项非严格反向归因：不是「缺回边」，是首版 BACK_LINKS 无条件赋值（`if ex.get(d) != to: ex[d] = to`）把 git 原版四处对边压掉了**——F8/F9 两针全是在给自己挖的坑上打的补丁。逐项：

| 红项 | 病根 | 修法 |
|---|---|---|
| road_xiyu_1.s↔road_xixia_1.n | `road_xixia_1.n` 原指 road_xiyu_1，被我写成 xixia_market | 原边恢复（n/s 双向与 HEAD 逐字一致）；集市改配 **road_xixia_1.se↔market.nw** |
| xixia_ice.n↔road_xixia_1.s | 同上（s 原指 xixia_ice，被我写成 xixia_post） | 原边恢复；驿馆改配 **road_xixia_1.sw↔post.ne** |
| xiyu_shule.s↔xiyu_oasis.n | `oasis.n` 原指 shule，被我写成 xiyu_well；F9 sw/ne 补丁连带多余 | 原边恢复（n）；井改配 **oasis.nw↔well.se**；F9 sw+ne 死键删净 |
| beijiang_houzhai.w↔xuedao.e | `xuedao.e` 原指 houzhai，被我写成 beijiang_market | 原边恢复（e）；冻市改配 **xuedao.w↔market.e** |
| road_many_1.e↔road_beijiang_1.w | `road_beijiang_1.w` 原指 road_many_1，被我写成 beijiang_yizhan | **升级为第七处闸门**：出北疆进荒原保头戏（93 口径三件套，road_many_1.e 的严格反向） |
| yizhan 首配 se↔nw | 82_treasury 后载占 `road_beijiang_1.nw`（xuedao_library），我的 nw 被盖 | 避让改配 **road_beijiang_1.se↔yizhan.nw**（分片序坑又一例） |
| xixia_pass.w↔kunlun_gate.e | 回边落在 104 深合并，map-check 合并清单看不见 | map-check.js 合并清单补 `104_birth_polish.json` |

**规则沉淀**：新房回边一律配「对向空闲方向对」（查全分片占键，不只看 50_map），绝不占既有房的原向键；BACK_LINKS 语义从「无条件赋值」收紧为「仅在对向空闲方向上落」。`_apply_act3_map.py` 已按终态重写（GATES 七处 / LANDMARKS+BACK_LINKS 方向重配 / RESTORE+REPAIR_OWN+DEAD_KEYS 三段），两连跑幂等；`_act3_map_check.js` 28/0（含保头闸配对断言）。

复验：map-check 6481/0（7→0）· smoke-sidequest 57/0 · smoke-mainline 47/0 · smoke-mainline35 141/0 · lore 17/0 · ai-flavor 0/0 · 四案 check 27/25/22/22。

## 六、批 2 引擎 lane 验收记（2026-10-17，寇豆码）

**两红裁决 + 真跑验收全绿，地图步引擎侧收口。**

| # | 项 | 落法 |
|---|---|---|
| 1 | smoke-guards「flag 都有出处」假红（road_gaibang_1/e 的 act2_done 只认房内 action effects） | 出处扫描口径扩至 quest 的 stages[].effects + rewards（act2_done 真实出处=60_quests q_main_sect rewards）；targets kind:'flag' 是监听不是置位、不进集合。32/0 |
| 2 | smoke-mainline35 taixu_hermit 红（名宿只在 demo_skill mod，M68 默认关） | 裁决=不给判据开口子，引擎换人：LEGEND_IDS taixu_hermit→**li_mochou**（40_npcs lv72，gumu_shan 直连官道；全库零 quest 引用、不撞主线 Boss/委托人；onNpcDown 任何 NPC 打倒都记 killed_，换人不伤机制；梯度 75/72/120）。136/0。**连带**：60_quests:1144 stage3 desc「太虚居士」待游有方改「李莫愁」——smoke-mainline 46/1 就等这一行（engine.js 注释在案） |
| 3 | 六闸门真跑 | 24/0：未置 act2_done 六向全拦（输出含 say 拦人戏、无 msg 兜底，93 口径实测）；置位后六向全放；bfsDistance/findPath 对门对象出口取 .to（钉 3）六对全可达、首跳方向全对 |
| 4 | F6-b 行路三态 | luoyang↔beijiang 双向 cross（cond act2_done）：未置=closed（refusal 老船工）、置位=ready；regions.entry beijiang=road_beijiang_1 落点房间在 |
| 5 | F7 判据连带 | jiangnan_east_road 无 s / mojiao_shanmen 无 n 双侧删净（山门现存 u=上崖路、s=hm_mojiao_dongfang 家园边，合法）；tools/design 判据零残留（引用全是房 id 级非边级） |

守卫终态（26 件全绿 + 1 待数据）：round4 75 · uiux 184 · quest-track 58 · noun 19 · storybeat 53 · social 82 · act2 143 · map-fog 19 · saveload 17 · martial 65 · mod-cap 51 · kidnap-ui 110 · ux-fixes 56 · mirror 11 · map-edge 34 · say-hint 15 · mapguide 89 · guards 32 · mainline35 136 · data-load 61+76 · actions 9 · act1 走通 77 · 第一分钟 21 · demo-mods 9 · quest-data 34 ——全 0 失败；smoke-mainline 46/1（唯一红=上述 60_quests 一行文案，data lane）。
改动件 md5：engine.js 73473e159b2e031d1755afb16afcad88 · smoke-guards.js 9b7d181fe7189c8faf03cc77657ca2e1 · smoke-mainline35.js 9d20a23ca470e88c0e051d14f4e92271（未 commit，铁律照报）。

