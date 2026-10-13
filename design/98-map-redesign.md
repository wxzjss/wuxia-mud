# 98 · 全地图重设计案（游有方，2026-10-16，第二步交付物）

> 承接：主人钦定三步走之第二步「根据剧情把地图重设计」。底稿：design/97《全剧情详细总纲》§六接口 + design/96《act1 地图案》（全案并入，不再单独立项）+ 本窗严苛玩家审查的出身/楔子可达性修正。
> 原则一句话：**地理跟着剧情走**——主线分章硬锁落在出口 cond 上，完成当前区域剧情才能进新区域；每一道锁都有一个站在门前的人说出一句出戏的话（93 口径），不许有干巴巴的「似乎有什么挡着」。

## 一、现状病图全表（实测可达性审计，非估计）

| # | 病 | 实测证据 | 等级 |
|---|---|---|---|
| P1 | act1 出生点四面裸通，独木桥/旧道成可选旁路 | road_jiangnan_1 四出口无 cond（96 §一） | P0（96 案已裁） |
| P2 | 卷三区（北疆/西域/西夏）物理无锁 | road_nan_1.w→beijiang、road_gaibang_1.e→xixia、road_many_1 两侧、jinguo_ruin.n、changan_gate.s/sw 六处裸通，无 act2_done 也可走进卷三 | P0 |
| P3 | 行路边落错区 | travel luoyang→mojiao（cond act2_done）落点是黑木崖山门（卷四 Boss 区）；beijiang/xiyu/xixia 三区无任何行路边 | P0 |
| P4 | 江南东街直通黑木崖 | jiangnan_east_road.s→mojiao_shanmen 遗产废边，江南一步进卷四总坛 | P0 |
| P5 | 楔子指路指向锁区（本窗修完） | 道观道童→桃花岛（卷四）、边地流人→日月神教（卷四）、逃卒→血刀门（卷三）、血仇遗孤→星宿派（卷三） | 已修（BIRTH_SECT 首选全部落卷二可达区，见 §八） |
| P6 | 教程第 6 步散人死锁（本窗修完） | 旧 test `!!p.sect`，散人永远卡 6/8 | 已修（认痕即过，见 §八） |
| P7 | regions 无入口点 | 行路降落靠「该区域第一间房」碰运气 | P1 |

## 二、重设计总图：五卷 = 五条走廊 + 各自腹地

| 卷 | 走廊（唯一动线） | 腹地（开放后可自由走） | 卷界锁 |
|---|---|---|---|
| 卷一 | 茶摊→青溪村→独木桥→山脚→华山→思过崖 | 茶摊/青溪村/荒野（黑松林） | 认痕后：江南城+岔路口+卷界行路开 |
| 卷二 | 拜山→门内三月→六案拼图→浮名 | 中原六区+43 山门 | act2_done 后：北渡口开 |
| 卷三 | 北渡口→雪谷哨卡→三线取证→截信 | 北疆/西域/西夏三环路网 | act3_done 后：上崖路哨卡开 |
| 卷四 | 上崖路→黑木崖三道哨卡→绣阁 | 黑木崖 | act4_done 后：皇城门+海路开 |
| 卷五 | 御街→渡海→面圣 | 皇城+东海+全开 | — |

## 三、act1 区：并入 96 案（落点清单，原文不再重复）

全案照 design/96 执行，落点汇总：

- **G1** road_jiangnan_1.n→jiangnan_gate：守门兵盘查（cond act1_recognized，msg/say 见 96 §三）。
- **G2** road_jiangnan_1.s→road_jiangnan_2：剪径的两个汉子（cond act1_recognized）。
- **G3** oldroad.nw→shanjiao_inn：常闭塌方折返；旧道保留看垫石支线戏房。
- **当铺迁移**：「给掌柜看信」jn_pawnshop→cunzhen_inn（62_shops 摘除，新分片承接）。
- **α 狼**：respawn 加挂 wild_forest_1。
- **教程一致性**：本窗已修 P5/P6，楔子指路全部指向卷二可达山门，第 6 步散人可过。

## 四、卷二区：维持现状，只列接口

中原六区+43 山门现状健康（S3 两批已上线），本步不动地理，只确认接口：

1. 43 山门软锁 = 闯山门拦截（71 现成），不入硬锁体系——89/90 钦定「永不锁的支线腹地」。
2. 卷二→卷三界 = 北渡口（见 §五），中原区本身不加新锁。
3. pre_a1 书坊/药圃两案随 act1 锁城后移（97 M3），不加 require，锁区即锁案。

## 五、卷三区：六闸门 + 行路边修正 + 三区入口（P2/P3/P7 治法）

**闸门（cond 统一 `flag:act2_done`，93 §二 北渡口老船工口径，msg/say/travel 三件套）**：

| # | 出口 | 挡路人说法（msg 骨架，施工时按 93 §二 原文口径成稿） |
|---|---|---|
| N1 | road_nan_1.w→road_beijiang_1 | 渡口的老船工：「冰没化实，船不敢开。急什么，河比你老。」 |
| N2 | road_gaibang_1.e→road_xixia_1 | 同上口径（渡河北去） |
| N3 | road_many_1.e→road_beijiang_1 | 蛮荒口的风沙话术：「往北那条道，开春才走人。」 |
| N4 | road_many_1.w→road_xiyu_1 | 同上（往西） |
| N5 | jinguo_ruin.n→road_beijiang_1 | 金国废墟的残兵/猎户口径 |
| N6 | changan_gate.s/sw→road_xiyu_1 | 明德门验关的兵：「出关的文书。没有？没有就回去。」 |

**行路边修正（70_world）**：
- luoyang↔mojiao 边（act2_done，老船工文案）**改挂 beijiang**（from/to 换区名，文案不动）。
- mojiao↔changan 边（act3_done，哨卡验牌）**维持**——卷三收束后黑木崖↔中原互通行路，语义正确。
- 新增 beijiang↔xiyu、xiyu↔xixia 两条 walk 边（三区内部路网已物理成环，行路面板补齐，免费直达）。

**regions 入口点（P7）**：beijiang.entry=road_beijiang_1、xiyu.entry=road_xiyu_1、xixia.entry=road_xixia_1、mojiao.entry=mojiao_shanmen（00_core regions 键深合并，落 act1 新分片同批）。

## 六、卷四区：黑木崖唯一入口（P4 治法）+ 哨卡立场挂点

1. **删废边**：jiangnan_east_road.s→mojiao_shanmen 删除（50_map 直接摘键；88 片 mojiao_path1-6 山路保留，黑木崖区内路网不动）。
2. **唯一入口 = 上崖路**：beijiang_shankou 加出口 u→mojiao_shanmen，cond `flag:act3_done`，93 §三 哨卡文案（灰衣人：「上崖路是教里的路。没牌子的人走到这儿，就是走到头了。」），msg/say/travel 三件套。
3. **L4 立场哨卡挂点**（97 卷四新增量，本步只留地理接口）：三道哨卡房用现成 mojiao_shanmen / mojiao_hall / mojiao_path3，立场（正/邪/散）戏挂 action，不在本步落。

## 七、卷五区：皇城+海路维持现状

- changan↔palace（act4_done，验引吏）与 harbor↔taohuadao（act4_done，船家）两道行路边现成，物理侧皇城 palace_street 挂江南城西门——act1 锁城后自然不可达，卷四末旗标控制，不加新锁。
- 桃花岛内部路网（taohuadao_path1-6，88 片）保留。

## 八、新手动线与教程一致性（本窗已修 + 待地图步收尾）

**本窗已落（tutorial.js，守卫全绿）**：
- BIRTH_SECT 首选全部落卷二可达区：wuxue→华山 / scholar·taoist_ward→武当 / orphan·deserter·border_drift→丐帮 / hunter·grudge→苗疆 / merchant→唐门 / noble→大理 / monastic→少林 / nun_ward→峨眉 / tomb_keep→古墓 / brothel_sold→合欢宗；锁区势力退居备选位（味留，路不指死）。
- 教程第 6 步 test 认 `p.sect || act1_recognized`，散人不再卡 6/8；goal 文案补「不走门墙的，把名字挣出来，路一样开」。
- 楔子指路：taoist_ward 末段改指武当（东海八字留作谜）、deserter 末段补「窝棚桥洞」暗指丐帮，全部过 smoke-b9-intro 文本禁令。

**待地图步收尾**：
- 96 G2 闸门落下后，教程第 6 步（递信上山门）在认痕前自然停在华山一线——华山 = act1 动线终点，wuxue 出身与 act1 同线；其余出身的拜师随 act1_recognized 解锁，节奏上是「教程陪跑 act1，认痕后递信」，不需改步序。
- 时辰门 huashan_pass 来源核对（96 §八风险#4）：若出自锁区，迁山脚小店/桥链（施工第一步先查）。

## 九、闸门文案口径（93 范式，全案统一）

每道锁 = `cond + msg + say + travel` 四件套：
- **msg**：被拦时站在门前的人说话（不出系统提示条，铁律 1）。
- **say**：放行那一刻的一次性场景句（锁开也是戏，铁律 2）。
- **travel**：走成时的过场句。
- 拒文案必须带指路（铁律 3：告诉你差什么、去哪挣）。
- 朱雀五维：禁忌词零、破折号 ≤2.38/千字、句长方差拉开（本窗新增文案已过 smoke-b9-intro 禁令面）。

## 十、影响与验收清单

| 项 | 影响 | 验收 |
|---|---|---|
| 96 G1/G2/G3 | _act1_walkthrough ⑤甲旧道断言改口径 | 走通脚本 46/0 复绿 + fresh 档锁区穷举段新增 |
| 卷三六闸门 | smoke-map-edge 双向对称（cond 不加出口不破对称）；smoke-guards msg 铁律 | 全套 smoke 复跑 |
| 行路边改挂+新增 | smoke 卷界断言（from/to 区名） | 行路 closed→ready 实测（照 act1 走通 ⑥ 式） |
| 黑木崖废边删除 | 凡依赖 jiangnan_east_road.s 的旧路径（若有测试/任务引用） | grep 引用清零 + smoke-act2 143 复跑 |
| smoke-newbie A-2/A-3 | 判据已改约记档（独特性让位可达性，本窗 57/0） | 不回退 |
| 散人 | 乙档从新动线走全程（桥链→认痕→夜宿→递信或散人过第 6 步） | 散人自查段 |

## 十一、施工拆分（批后执行，全部设计批完前 data 零改动）

1. **act1 批**：50_map G1/G2/G3 + 旧道折返 + 狼 spawn；新分片承接看信；62_shops 摘除；走通脚本改口径
2. **卷三界批**：50_map N1–N6 闸门 + 70_world 边修正 + regions 入口
3. **卷四批**：废边删除 + 上崖路 u 出口
4. **教程收尾批**：时辰门来源核对/迁移（若需要）
5. 全量回归 + 朱雀门 + 散人乙档自查

---

**引用**：97 §六（接口七条，本稿全部落位）、96（act1 全案）、95 §八（思过崖 or 形门槛，已在位）、93（卷界文案口径）、89/90（分章硬锁方向令与区域演进表）。
