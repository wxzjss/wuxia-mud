# 《NPC 人物画像规格书》

版本 v1.0 · 设计策略师 · SPRINT1-DESIGN-01 · 交付 1

> 本文所有字段名、取值、id 均已对照真实数据核对过：
> `game/data/40_npcs.json`（320 条，288 条 `npcv_*` + 32 条具名）、`50_map.json`（619 房 / 32 region）、
> `game/src/core/world.js#spawnNpc`、`personality.js`、`social.js`、`modapi.js`。
> 不写实现代码，只给工程侧可直接照做的判断与字段。

---

## 0. 落地前提：先修 4 个数据 Bug（否则画像写得再好也露不出来）

画像要"能被玩家看见"，第一落点是 `look` 打出来的 `desc`。当前 `desc` 有硬伤，必须先修。

| # | 问题 | 实测证据 | 修复判断 |
|---|---|---|---|
| B1 | **45 个 NPC 共用同一条 desc**，其中 27 个是女性 | `desc = "寻常人家的汉子，袖口磨得发白，见人先笑，是那种过日子的老实人。"` 被 45 人共用，横跨 commoner / beggar / refugee / courtesan / singer 五种身份；女性持有者 27 人（如 `npcv_021` 汪秋、`npcv_046` 雷白露、`npcv_219` 梅拾） | 按 `tag × gender` 重建 desc 模板表，45 人重刷。女性一律不得出现"汉子/他" |
| B2 | **身份与落点错配** | 9 个 `courtesan` 全在 `mojiao_shuangxiu`（黑木崖·绣阁）与 `jn_wine_house`，**醉春楼（qinglou，7 个房间）一个青楼女子都没有**；9 个 `richman` 全挤在 `jn_brothel_2`（醉春楼·听雨轩）；`farmer` `npcv_004` 落在 `jn_silk_shop`；`escort` `npcv_015` 落在 `shaolin_lianwu` | 建"身份 → 允许区域"白名单表，跑一次重摆。青楼女子必须进 qinglou；富商必须在 market / 自宅 / 酒楼，不能全员蹲青楼 |
| B3 | **tag 误挂** | `nv_huang` 黄药师 tag = `doctor`（应为隐士/岛主）；`npcv_021` 汪秋 tag = `courtesan` 但 desc 是 commoner 模板 | tag 白名单校验：tag 必须落在本规格 §3.3 的身份表里，且 desc 模板必须取自同 tag |
| B4 | **age 与身份冲突** | `shenni` 神秘老僧 age=19；`shaolin_fangzheng` 方证大师 age=26；`emei_miejue` 灭绝师太 age=20；`beggar_boy` 小叫花 age=44 | age 按 tag 给区间：僧道长老 50+，掌门 40+，小叫花 ≤ 14。age 由生成器按 tag 重刷，具名 NPC 手写覆盖 |

**判断**：B1/B4 由 `tools/gen-portraits.js` 的 `--fix-desc` / `--fix-age` 开关一并处理；B2/B3 单独出一次 `tools/gen-placement-fix.js`，必须在画像生成**之前**跑。顺序错则画像里的"当下处境"会和落点对不上。

---

## 1. 字段 Schema

### 1.1 挂载位置决策：新开 `portrait` 子对象，不扩顶层字段

**结论：挂 `def.portrait`（子对象），理由三条。**

1. `40_npcs.json` 顶层已有 47 个字段（实测字段频次统计），再加 12 个画像字段会把模板撑到 60 字段，生成器读写的"字段白名单"会失控。
2. `portrait` 是纯展示/叙事数据，与战斗（`atk`/`hp`/`learned`）和社交（`favor`/`rel`/`likes`）正交，物理隔离后 `spawnNpc` 只需加 2 行。
3. 幂等判定最简单：生成器只判定 `def.portrait && def.portrait.v === 1` 就跳过，不用逐字段判空。

**不挂 `vars` / `flags`**：那两个是运行期效果字段（`p.getVar`），语义完全不同，混进去会被 mod 的条件解释器读到。

### 1.2 静态字段表（写入 `def.portrait`，模板层，随 40_npcs.json 走）

| # | 中文名 | key | 类型 | 取值范围 | 必填 | 示例 |
|---|---|---|---|---|---|---|
| 1 | 身份定位 | `role` | string | 12~30 字，一句话说清"他是谁、管哪一片" | **必填（三级全要）** | `"江南府衙后衙的女捕快，管城东三坊的贼情"` |
| 2 | 出身来历 | `origin` | string | 30~120 字 | A 必填 / B 必填(缩写到 30~50) / C 不填 | `"本是洛阳米商之女，十八岁那年漕船翻在黄河，一家七口只剩她一个，被衙门书办收留，从此吃了公门饭"` |
| 3 | 当下处境 | `now` | string | 20~60 字，写"此刻正为什么发愁" | **必填（三级全要）** | `"手上压着三桩悬案，上头只给十天期限"` |
| 4 | **欲望** | `want` | string | 15~40 字，一句话，动词开头 | **必填（三级全要）** | `"攒够三百两，把当年举报她爹的那个人翻出来"` |
| 5 | **恐惧**（增补） | `fear` | string | 15~40 字 | A 必填 / B 必填 / C 选填 | `"怕上头翻旧账，把她收留流民的事抖出来"` |
| 6 | **隐秘** | `secret` | object \| null | 见下表 | A 必填 / B、C 不填 | — |
| 7 | 执念 / 心结 | `obsession` | string | 20~60 字 | A 必填 / B、C 不填 | `"每年七月十五，都要在黄河边烧一船纸"` |
| 8 | 恩怨 | `feuds` | array | 每项 `{id, kind, why, since}`；`id` 必须是 `def.rel` 里已有的 id | A 必填(2~4) / B 选填(0~2) / C 不填 | 见 §1.5 |
| 9 | 说话腔调 | `voice` | object | `{tone, catchphrase, taboo, style}` | 三级全要（C 只填 tone + catchphrase） | 见下表 |
| 10 | 日常行为 | `routine` | array | 每项 `{at, act}`；`at ∈ {day, night, dawn, dusk, meal}` | A 必填(2~3) / B 必填(1) / C 不填 | `[{at:"day", act:"蹲在茶馆后门剥豆子，眼睛盯着街上每一个生面孔"}]` |
| 11 | 态度曲线 | `arc` | object | `{init, warm, cold, break}` | A 必填(全) / B 必填(init+warm) / C 选填(init) | 见下表 |
| 12 | **故事钩子** | `hooks` | array | 每项 `{id, title, type, trigger, seed, rewardHint}` | A 必填(1~3) / B 选填(0~1) / C 不填 | 见 §1.5 |
| 13 | 机器标签（增补） | `marks` | array\<string\> | 取自 §2.4 的标签词典，1~3 个 | **必填（三级全要）** | `["债","官","丧亲"]` |
| M1 | 规格版本 | `v` | int | 固定 `1` | 必填（生成器写） | `1` |
| M2 | 层级 | `tier` | enum | `A` / `B` / `C` | 必填（生成器写） | `"A"` |
| M3 | 手写锁 | `lock` | bool | 手工改过就置 `true`，生成器永不覆盖 | 选填，默认 false | `true` |

#### `secret` 子结构

| key | 类型 | 取值 | 说明 |
|---|---|---|---|
| `text` | string | ≤ 60 字 | 秘密本身 |
| `tier` | int | 0 / 1 / 2 / 3 | **暴露门槛**：0=见面即知（不算秘密，只是当众不说）；1=好感"友善"(≥20) 或 trust≥40；2=好感"亲密"(≥60) 且 trust≥70；3=必须取证/完成 hook 才解锁 |
| `leakTo` | array\<npcId\> | defId 列表 | 哪几个人知道（走漏源）。**必须非空**，否则无人可传，传闻系统无种子 |
| `ifLeaked` | string | ≤ 40 字 | 走漏后的后果描述，交给事件系统做 effects |

#### `voice` 子结构

| key | 类型 | 取值 | 说明 |
|---|---|---|---|
| `tone` | enum | `敬 / 谦 / 傲 / 泼 / 讷 / 油 / 冷 / 酸 / 痴` | 9 种。**与 `personality` 的 9 种性格是两套东西**，仲裁规则见 §4.2 |
| `catchphrase` | string | 4~14 字 | 口头禅，`talk` 时按概率前缀露出 |
| `taboo` | array\<string\> | 话题词 | 玩家 `ask` 命中时掉好感（−5~−15，按 tier 加权） |
| `style` | string | 描述句 | 给写手看的执行说明："短句，爱用反问，说到钱就压低声音" |

#### `arc` 子结构（与 `social.js` 的 FAVOR_TIERS 六档直接对齐）

现有档位实测：`死敌(-200~-60) / 冷淡(-60~-15) / 平常(-15~20) / 友善(20~60) / 亲密(60~120) / 知己(120~300)`。

| key | 类型 | 取值 | 说明 |
|---|---|---|---|
| `init` | enum | 六档名之一 | 初始态度。生成器写，**必须与 `def.favorInit` 落在同一档**（校验项） |
| `warm` | string | 条件描述 | 升温条件，例：`"替她抓一个贼 +30"` |
| `cold` | string | 条件描述 | 降温条件，例：`"当着官面上揭她的短 −20"` |
| `break` | string | 条件描述 | 破裂条件，触发后永久敌对（`npc.hostile = true`），例：`"把她爹的案子闹到府台面前"` |

### 1.3 运行期字段表（挂在实例 `npc.pstate`，必须能 serialize）

| key | 类型 | 范围 | 说明 |
|---|---|---|---|
| `trust` | int | 0~100 | **信得过你**。与 `favor`（喜欢你）是两条独立轴——讨好可以让 favor 高但 trust 低，办成事才涨 trust。`secret.tier` 的门槛用 trust 判，不用 favor |
| `revealed` | array\<string\> | `[]` / `["secret"]` | 已解锁的秘密。预留多秘密扩展 |
| `hooks` | object | `{hookId: "latent"\|"offered"\|"done"\|"failed"}` | 钩子状态机 |
| `met` | int | ≥0 | 见面次数，用于 `arc.init` 的"生人/熟人"分支 |
| `moodBias` | int | −20~+20 | 画像给的心情基线偏移，见 §4.3 |
| `leaked` | bool | 默认 false | 秘密是否已被走漏（走漏后全局生效，不可回退） |

**为什么必须有运行期字段**：玩家"揭穿一个人的秘密"是一次性事件，写死在模板里则所有存档共享进度；写进实例才能随档走。

### 1.4 相对需求清单的增删与理由

| 处置 | 字段 | 理由 |
|---|---|---|
| **增** | `fear`（恐惧） | 需求原清单只有"欲望"。但江湖味的大头来自"怕"——被威胁、被勒索、被揭短时的反应。**没有 fear 的 NPC 在胁迫情境下无话可说**，而胁迫正是玩家最常制造的交互。欲望+恐惧才是完整的动机对 |
| **增** | `marks`（机器标签） | 原清单全是自然语言字段，传闻系统和随机事件库（交付 2）无法检索。"哪几个 NPC 能被催债事件选中"必须靠 `marks` 包含 `"债"` 来筛，靠分词匹配不可靠且不可测 |
| **增** | `secret.leakTo` / `secret.ifLeaked` | 秘密若无人知晓、走漏无后果，就是死数据。`leakTo` 直接给传闻系统当传播源，`ifLeaked` 给事件库当效果链 |
| **改** | "日常行为模式" → `routine`，且绑定 `at` 时段 | 原写法容易和 `def.schedule` 打架。**职责切死**：`schedule` 决定"人在哪个房间"，`routine` 决定"人在做什么动作"，二者由 `at` 键对齐（day/night） |
| **改** | "对玩家的态度曲线" → `arc` 四段，不用曲线数组 | 曲线数组无法落地。`arc` 直接复用 `social.js` 已有的 FAVOR_TIERS 六档名与 `favorInit` 数值，可写断言校验 |
| **删** | "秘密"不设多条 | A 层只允许 1 条 secret。多条秘密会让"解锁进度"变成二维状态机，工程成本翻三倍，收益为零。留 `revealed` 为数组只为将来扩展 |

### 1.5 完整 JSON 骨架（A 层示例，B/C 层按 §2.3 裁剪）

```json
"portrait": {
  "v": 1,
  "tier": "A",
  "lock": false,
  "role": "江南府衙后衙的女捕快，管城东三坊的贼情",
  "origin": "本是洛阳米商之女，十八岁那年漕船翻在黄河，一家七口只剩她一个，被衙门书办收留，从此吃了公门饭。",
  "now": "手上压着三桩悬案，府台只给了十天期限。",
  "want": "攒够三百两银子，把当年举报她爹的那个人翻出来。",
  "fear": "怕上头翻旧账，把她私放流民的事抖出去。",
  "secret": {
    "text": "三年前她私放过一个偷官粮的少年，那少年如今在丐帮。",
    "tier": 2,
    "leakTo": ["npcv_214", "npcv_073"],
    "ifLeaked": "停职查办，丐帮声望 −20"
  },
  "obsession": "每年七月十五，都要在黄河边烧一船纸钱。",
  "feuds": [
    { "id": "npcv_065", "kind": "仇", "why": "那赌棍三次作伪证，害她白跑了半年", "since": "去年秋" }
  ],
  "voice": {
    "tone": "冷",
    "catchphrase": "公门里面，没有私事。",
    "taboo": ["爹", "黄河", "洛阳"],
    "style": "短句，先问后答，说到案情就压低声音"
  },
  "routine": [
    { "at": "day",   "act": "蹲在茶馆后门剥豆子，眼睛盯着街上每一个生面孔" },
    { "at": "night", "act": "一个人在灯下翻旧卷宗，翻到某页就停下" }
  ],
  "arc": {
    "init": "平常",
    "warm": "替她抓一个贼 +30；送她一坛黄酒 +10",
    "cold": "当着官面上揭她的短 −20；在她面前提「黄河」−10",
    "break": "把她爹的案子闹到府台面前"
  },
  "hooks": [
    {
      "id": "hk_npcv_181_liang",
      "title": "官粮案的旧账",
      "type": "task",
      "trigger": { "flag": "trust_npcv_181_ge_60" },
      "seed": "她私放的那个少年，如今是丐帮七袋弟子。",
      "rewardHint": "+rep 丐帮 30；解锁 secret；开启 sq_npcv_181 第二阶段"
    }
  ],
  "marks": ["官", "丧亲", "旧案"]
}
```

---

## 2. 分层生产策略（320 人不可能都精写）

### 2.1 三级配额

| 层 | 名称 | 人数 | 占比 | 生产手段 |
|---|---|---|---|---|
| **A** | 核心层 | **40** | 12.5% | 人工精写（或 LLM 精写后人工过一遍），一人一稿 |
| **B** | 骨干层 | **90** | 28.1% | 半模板：身份模板骨架 + 3~5 个变量槽人工填 |
| **C** | 众生层 | **190** | 59.4% | 全模板：`tag × region × gender` 模板表 + 变量槽，机器生成 |

**字数总账**：A 40×560 + B 90×200 + C 190×60 ≈ **51,800 字**（约 5.2 万字）。这是可控的一次性产能投入；若全量按 A 层写则是 18 万字，不现实。

### 2.2 A 层（核心层）选择规则 —— 打分 + 强制配额，不随机

#### 打分公式（各项可实测，不靠拍脑袋）

```
score = 10×W_tag + 6×W_region + 8×W_quest + 5×W_rel
```

**W_tag（身份戏份权重 0~3）**

| 权重 | tag / 条件 |
|---|---|
| 3 | `def.sect` 非空且 `def.rank >= 4`（14 位掌门/长老）；`tag === 'official'`；id 属于 32 位具名 NPC |
| 2 | `constable escort innkeeper doctor madam courtesan merchant richman monk taoist nun thief gambler smith scholar eunuch` |
| 1 | `farmer vendor waiter waiter2 groom hunter boatman actor singer child commoner palace consort` |
| 0.5 | `refugee` |

**W_region（所在区域权重 0~2，按房间数/玩家动线实测）**

| 权重 | region |
|---|---|
| 2 | `jiangnan`(184 房) `market`(35) `luoyang`(53) `changan`(50) `chengdu`(49) `xiangyang`(45) `cunzhen`(24) `farmland`(20) `shuyuan`(15) `yamen`(14) `harbor`(12) `qinglou`(7) |
| 1.5 | `huashan shaolin wudang emei gaibang tangmen dali gumu taohuadao xiake mojiao`（门派/剧情锚点） |
| 0.5 | 官道与边荒：`beijiang xiyu xixia miaojiang haitan jinguo wild secret many` |

**W_quest（能否长任务，累加，上限 2）**

- 有 `def.sidequest` → +1
- 有 `def.ask`（能问出东西）→ +1
- `def.teach` 里含非 `basic_` 前缀的技能 → +0.5

**W_rel（关系戏份 0~1）**

- `def.rel` 中含 `kind:"仇"` → +1
- `def.rel.length >= 5`（关系枢纽）→ +0.5
- 与任一已入选 A 层的 NPC 有边 → +0.5

#### 强制配额（先于打分分配，占 A 层 40 席中的 32 席）

| 配额 | 席数 | 规则 |
|---|---|---|
| 门派掌门/长老 | 14 | `def.sect` 非空且 `rank>=4`，一个门派至少 1 人（实测 15 人带 sect） |
| 具名非掌门 | 5 | 32 位具名里除掌门外的高戏份者：`药婆婆` `瞎眼老丐` `独眼老刘` `游方剑客` `城门守卫` |
| 玩家常驻区域 | 9 | jiangnan / market / yamen / farmland / cunzhen / qinglou / shuyuan / harbor / 四大城之一，各 ≥1 人 |
| 身份覆盖补足 | 4 | 前 28 席若未覆盖 `courtesan / richman / scholar / farmer`，各补 1 人 |
| **自由竞争** | **8** | 剩余按 score 降序取，优先给"仇边数最多"的关系枢纽 |

**硬性约束**：A 层 40 人里，**具名 NPC 不超过 20 人**。理由：具名角色（岳不群/灭绝/洪七公）已有金庸原著人设，玩家本来就记得住；画像工程的价值在于让 288 个 `npcv_*` 里的**一部分**变得可记。把 A 层配额浪费在具名角色上是无效投入。

### 2.3 各层字数 / 字段密度配额表

| 字段 | A（40 人） | B（90 人） | C（190 人） |
|---|---|---|---|
| `role` | 12~30 字 | 12~20 字 | 8~15 字（模板槽） |
| `origin` | 30~120 字 | 30~50 字 | — |
| `now` | 20~60 字 | 15~30 字 | — |
| `want` | 15~40 字 | 12~25 字 | 10~18 字（模板槽） |
| `fear` | 15~40 字 | 10~20 字 | — |
| `secret` | 1 条 ≤60 字 | — | — |
| `obsession` | 20~60 字 | — | — |
| `feuds` | 2~4 条 | 0~2 条 | — |
| `voice.tone` | ✓ | ✓ | ✓ |
| `voice.catchphrase` | ✓ | ✓ | ✓（模板槽） |
| `voice.taboo` | 1~3 个 | — | — |
| `voice.style` | ✓ | — | — |
| `routine` | 2~3 条 | 1 条 | — |
| `arc.init` | ✓ | ✓ | 选填 |
| `arc.warm/cold` | ✓ | warm ✓，cold 选填 | — |
| `arc.break` | ✓ | — | — |
| `hooks` | 1~3 条 | 0~1 条 | — |
| `marks` | 1~3 个 | 1~2 个 | 1 个 |
| **单篇总字数** | **420~700 字** | **150~260 字** | **40~80 字** |

### 2.4 C 层模板槽设计（190 人怎么不重样）

模板 = `tag × region × gender` 三元组 + 3 个变量槽，槽位从素材库按**固定种子**取（与 `gen-social.js` 同种子 `20261008`，保证姓名/关系/画像三者一致）。

```
role  = "{姓}{名}，{region_cn}的{tag_cn}"
want  = WANT_POOL[tag][rng]      // 每 tag 8~10 条
catchphrase = PHRASE_POOL[tone][rng]  // 每 tone 6~8 条
marks = MARKS_POOL[tag]          // 每 tag 固定 1~2 个
```

**槽位素材必须按 tag 分池，不能全库随机**。例：`farmer` 的 want 池只能是"交完租还能剩两石/给儿子攒娶亲钱/把东头那块盐碱地养过来"，绝不能抽到 `courtesan` 池里的"攒够赎身的钱"。

**反重样硬约束**：同一 `tag × region` 组合内，`want` 与 `catchphrase` 不得重复；素材池耗尽则允许重复但必须换 `role` 的修饰语。生成器需输出"重复率报告"，重复率 > 15% 判不合格。

---

## 3. 写作规范

### 3.1 武侠白话语气标准

1. **句式**：以四到八字短句为主，一句一个动作。禁用复句嵌套、禁用"因为……所以……"。
2. **称谓**：自称用"在下/老汉/贫道/老衲/奴家/小女子"，对称用"兄台/足下/客官/施主/这位爷/你老"。禁用"您"。
3. **钱**：一律"文 / 两 / 银子 / 铜钱"，禁用"元、块、毛"。
4. **时间**："三年前 / 上月 / 昨儿 / 打从清明起"，禁用"上周、月底、季度"。
5. **距离**："里 / 步 / 丈"，禁用"公里、米"。
6. **动作先行**：对话前给一个肢体描写，例：`"（他把茶碗往桌上一顿）"`。
7. **不说尽**：画像里至少留一处"他没说完"。江湖味来自留白，不来自信息完整。

### 3.2 禁用现代词清单（生成器校验器硬拦截，命中即报错）

**机构/职业类**：警察、公司、老板（可用"掌柜/东家"）、单位、部门、系统、项目、团队、客户、员工、经理、政府、组织、机构、集团

**抽象名词类**：问题（用"麻烦/过节/难处"）、压力、情绪、沟通、关系网、资源、信息（用"消息/风声"）、状态、情况、方式、模式、目标（用"想头/指望"）、计划、机会（用"时机"）、风险、概念、意识

**生活器物类**：手机、电话、电脑、网络、车（用"车马/骡车"）、银行、超市、酒店（用"客栈/酒楼"）、医院（用"药铺/医馆"）、学校（用"书院/学堂"）、票（用"凭据/牌子"）、快递、密码

**动词/副词类**：处理、解决（用"了断/摆平"）、安排、配合、联系、汇报、检查、确认、提供、支持、参与、通过、进行、实现、优化、反馈、运营

**时间/度量类**：分钟、小时（用"刻/时辰/盏茶工夫"）、星期、周末、季度、公里、米、公斤、% 、编号、序号

**其他**：的（每百字不得超过 8 个）、了（每句不得超过 1 个）、"他/她"混用（一篇之内必须统一，按 `gender` 走）

### 3.3 姓名与地域一致性规则

**姓氏与 region 绑定表**（C 层与 B 层生成时必须查表，A 层手写须遵守）

| 区域 | 高频姓氏 |
|---|---|
| jiangnan / market / gusu | 顾、陆、沈、钱、唐、叶、归、卫 |
| luoyang / changan / 中原 | 王、李、张、刘、郑、元、杜 |
| chengdu / tangmen（蜀中） | 唐、杜、苏、彭、雷、蒲 |
| huashan / shaolin / wudang | 岳、封、成、郝、任、和 |
| yamen（公门） | 元、葛、毕、闵、凤（官宦味，少用市井姓） |
| xiyu / beijiang / xixia | 允许异姓：赫连、拓跋、完颜、耶律、慕容 |
| miaojiang | 蓝、雷、盘 + 苗名（如"阿蚩"） |
| dali | 段、高、董、杨 |

**僧道法号规则**

- 僧：法号两字，末字取 `澄 空 净 慧 苦 痴 缘 渡 真 觉`（例：澄空、苦渡）。**不得用俗姓**。
- 道：道号两字 + "道长/真人"，取 `冲虚 清虚 玄真 长春 玉虚 守一`。
- 尼：法号 + "师太/师父"，取 `静 慧 圆 明 空 妙` + 一字。

**禁用**：僧道 NPC 出现"父子/娶妻"类关系；`monk`/`nun` 的 `feuds` 不得含 `kind:"亲"` 的异性配偶关系（现有 `rel` 里有 `亲` 边的僧道需单独清洗）。

### 3.4 呈现约定 —— "画像必须能被玩家看见"

画像写进 JSON 但露不出来 = 白写。**分层露出表**（工程侧照此实现）：

| 露出层 | 触发入口 | A 层露出 | B 层露出 | C 层露出 |
|---|---|---|---|---|
| **L0 看见** | `look`（房间内） | `desc` + `routine[当前时段].act` 拼一行 | `desc` + `routine.act` | `desc` |
| **L1 听见** | `talk` | 30% 概率在台词前加 `voice.catchphrase` | 15% 概率 | 无 |
| **L2 问出** | `ask <人> 关于 <本人名>/来历/近况` | `origin`（trust≥0）、`now`（trust≥20）、`want`（trust≥50）、`fear`（trust≥70） | `now`（trust≥20） | 走 `askDefault` |
| **L3 侧闻** | 新增指令 `打听 <人名>`（见下） | 同区域 1~3 条传闻 + 他人评价（按评价者与他的 `rel.kind` 变色：亲=回护、友=说好话、仇=踩一脚） | 一句评价 | "没听说过这号人。" |
| **L4 泄密** | 送礼命中 `likes` / 救命 / 醉酒 / 完成 hook 后 | `secret`（按 `secret.tier` 门槛） | — | — |
| **L5 目击** | 撞见 `routine` 里的异常动作（如"夜里翻卷宗"） | 触发对应 `hooks`，改为 `offered` | — | — |

**两条工程约定**

1. **画像自动注册进 `def.ask`**：生成器把 `role / origin / now / want / fear` 各注册成一条 ask topic，`keywords` = `[姓名, 本人名, "你是谁", "来历", "近况"] + marks`。这样**不用改 `commands.js` 的 ask 逻辑**（`ask` 已支持 keywords 包含匹配），L2 层就能落地。
2. **新增 `打听` 指令**（`reg(['打听','inquire','打探'])`）：入参是人名，查"传闻表"（交付 2 的 `world.rumors`）+ 该 NPC 的 `rel` 关系网，输出 L3 层内容。**这是画像系统唯一必须新增的指令**，其余全部复用现有 `look/talk/ask`。

---

## 4. 与现有系统的接口

### 4.1 挂进 `40_npcs.json`

- 位置：每个 NPC 模板下新增 `"portrait": {...}` 子对象。
- **不新增顶层字段**，不改任何现有字段语义。
- `spawnNpc` 需加 2 行（工程侧）：

```js
npc.portrait = clone(def.portrait || null);
npc.pstate   = { trust: 0, revealed: [], hooks: {}, met: 0, moodBias: 0, leaked: false };
```

**必须 clone，不能直接 `npc.portrait = def.portrait`**——否则运行期写入 `revealed` 会污染模板，"改一个带动全江湖"（`social.js` 头部注释里已经踩过一次的坑）。

### 4.2 与 `personality`（9 性格）的仲裁 —— 防打架

现有：`personality.js` 里 9 种性格，每种带一个说话动词（`哈哈笑道 / 冷哼道 / 嗫嚅道 / 正色道 / 嘻嘻笑道 / 讷讷道 / 柔声道 / 瞪眼道 / 淡淡道`），`sayVerb()` 输出，被 `talk` 指令调用。

画像新增 `voice.tone`（9 种腔调）。**两者会打架**，仲裁规则如下：

| 规则 | 说明 |
|---|---|
| **职责切分** | `personality` 管**说话动词**（怎么开口），`voice.tone` 管**句式与用词**（说什么话）。二者正交，正常情况下不冲突 |
| **覆盖优先级** | 仅当 `tone ∈ {敬, 泼, 酸}` 时，`voice.tone` 覆盖 `personality` 的说话动词（分别改为 `躬身道 / 叉腰道 / 阴阳怪气道`）；其余 6 种 tone 保留 `personality` 的动词 |
| **心情覆盖一切** | `mood <= 20` 时，无论 personality 还是 tone，一律输出 `有气无力道`；`mood <= 5` 输出 `万念俱灰，喃喃道`。**现有 `sayVerb()` 已经这么做了，保持不动** |
| **校验项** | 生成期断言：`voice.tone` 与 `personality` 不得同时指向"冷漠"语义（`lengmo` + `冷`）造成死板叠加，命中则把 tone 改为 `讷` |

### 4.3 与 `mood`（心情 0~100）的衔接

- `pstate.moodBias` 由画像推导：`obsession` 非空 → −5（有心结的人基线更低）；`marks` 含 `"丧亲"` → −8；含 `"新婚"`/`"得子"` → +10。
- `spawnNpc` 里：`npc.mood = clamp((def.mood ?? 50) + moodBias, 0, 100)`。
- **恢复速率**：`obsession` 非空的 NPC，心情向 50 回归的速度减半（有心结的人不容易高兴起来）。这条要改 `personality.js#addMood`，属可选优化，不阻塞交付。

### 4.4 与 `tag`（身份）的衔接

- `tag` 是**权威字段**，画像不得改写 `tag`。
- `portrait.role` 的第一个词组必须含该 tag 的中文名（`personality.js` 里 `TAG_PERSONALITY` 的键对应中文见 `gen-social.js` 的 `TAGS[tag].cn`）。
- **冲突判定**：若 `role` 描述与 `tag` 明显矛盾（如 tag=`monk` 但 role 写"带着三个徒弟跑商"），校验器报错。

### 4.5 与 `rel`（1050 条关系边）的衔接

实测：`rel` 共 1050 条边，kind 只有 `仇(138) / 友(680) / 亲(232)` 三种。

| 规则 | 说明 |
|---|---|
| **feuds 只能补，不能建** | `feuds[].id` 必须 ∈ `def.rel[].id`。**画像系统禁止新增关系边**，否则会破坏 `rel` 的双向一致性（A 认 B 为友，B 却不认 A） |
| **kind 必须一致** | `feuds[].kind` 必须与 `def.rel` 里对应边的 `kind` 相同。不一致 → 校验器报错 |
| **why 补的是动机** | `rel` 只说"是仇"，`feuds.why` 说"为什么是仇"。**这是画像对关系网唯一的增值点**，也是传闻系统生成"恩怨类传闻"的素材 |
| **单向即可** | 只需在有画像的那一侧写 `feuds`，对侧不必对称回写（省一半字数） |

### 4.6 与 `favor`（好感 −200~300）的衔接：trust 是第二条轴

现有 `social.js` 的 `FAVOR_TIERS` 六档只表达了"喜欢你"。但"喜欢"和"信任"是两回事：

| 组合 | 玩家体验 | 用什么解锁 |
|---|---|---|
| favor 高 / trust 低 | 他跟你很热络，但**不告诉你真话** | 送礼、陪酒 → 只涨 favor |
| favor 低 / trust 高 | 他不喜欢你，但**承认你办事靠谱** | 完成委托、守口如瓶 → 只涨 trust |
| 双高 | 愿意交底 | 解锁 `secret` |

**涨 trust 的行为清单**（工程侧照做，每次 +5~+15）：完成该 NPC 或他 `rel.友/亲` 的委托；拒绝在他 `rel.仇` 面前说他的坏话；保守一个已解锁的 secret 超过 30 游戏日。
**掉 trust 的行为**：偷窃他被抓（−30，复用 `social.js:440` 已有的偷窃逻辑）；在他面前杀他的 `rel.亲/友`；把 secret 说给第三人。

### 4.7 静态 / 运行期边界与 serialize 要求

| 数据 | 存放 | 是否随档 | 说明 |
|---|---|---|---|
| `portrait.*`（全部静态字段） | `def.portrait`（模板） | 否（随版本走） | 只读 |
| `pstate.trust / revealed / hooks / met / leaked` | 实例 `npc.pstate` | **是** | 玩家进度，必须随档 |
| `world.rumors`（交付 2） | `world` 上 | **是** | 需在 `serialize()` 里显式加字段 |
| `faction`（交付 2） | `world` 上 | **是** | 同上 |

**serialize 注意**：`world.serialize()` 用 `safeInstanceMap(this.instances.npcs)` → `cleanInstance()` 遍历实例自有可枚举属性。只要 `pstate` 挂在 `npc` 上就会自动入档，**不需要改 serialize**。但有一个**深度陷阱**：`cleanInstance` 在 `depth > 8` 时返回 `undefined`。`portrait` 结构最深为 `npc(0) → portrait(1) → secret/hooks(2) → 子字段(3)`，安全；**但 `hooks[].trigger` 里若嵌套超过 5 层 `and/or/not` 条件会被静默丢弃**。约定：`trigger` 的嵌套深度 ≤ 3。

---

## 5. 落地路径：`tools/gen-portraits.js` 设计要点

### 5.1 幂等三原则（照抄 `gen-social.js` 已有的约定，不要另起炉灶）

1. **存在即跳过**：`def.portrait && def.portrait.v === 1` → 跳过该 NPC。
2. **手写锁**：`def.portrait.lock === true` → 永不覆盖，且报告中列出"受保护条目"。
3. **同种子可复现**：`mulberry32(20261008)`，与 `gen-social.js` 完全相同的种子与 `pick/pickN/int` 工具函数。**换种子会导致姓名、关系、画像三者对不上**。

### 5.2 分档与开关

| 开关 | 作用 |
|---|---|
| `--tier=A\|B\|C` | 只生成某一层（先做 A 层 40 人验收，再跑 B/C） |
| `--only=tag1,tag2` | 只处理指定身份（调试用） |
| `--id=npcv_181` | 单条重生成 |
| `--dry` | 只输出 diff 不落盘 |
| `--fix-desc` / `--fix-age` | 顺带修 §0 的 B1 / B4 |
| `--report` | 输出 `tools/out/portrait-report.md` |

### 5.3 校验器（生成后必跑，不通过不许合入）

| 校验 | 判据 |
|---|---|
| **关系闭合** | `feuds[].id ⊆ def.rel[].id`；`feuds[].kind === rel 对应边的 kind` |
| **引用存在** | `hooks[].trigger` 里引用的 flag / item / skill / room / npcId 必须在对应数据文件里存在（可查 `20_items.json` `10_skills.json` `50_map.json` `40_npcs.json`） |
| **态度一致** | `arc.init` 对应的档位区间必须包含 `def.favorInit` |
| **字数配额** | 按 `tier` 断言 §2.3 的总字数区间 |
| **禁用词** | §3.2 清单全文扫描，命中即报错并打印位置 |
| **性别一致** | 全文不得出现与 `gender` 相悖的代词（女 NPC 出现"他/汉子"→ 报错） |
| **重复率** | C 层同 `tag×region` 内 `want`/`catchphrase` 重复率 > 15% → 警告 |
| **嵌套深度** | `hooks[].trigger` 深度 ≤ 3 |

### 5.4 落盘与回滚

1. 落盘前先 `cp 40_npcs.json 40_npcs.json.bak`（`tools/_bak/` 已有备份目录习惯）。
2. 写入时 `JSON.stringify(data, null, 2)`，保持与现有文件一致的 2 空格缩进（现有文件是 2 空格）。
3. 生成报告必须包含：各层人数、平均字数、缺失字段数、受保护条目数、校验失败条目数。

### 5.5 建议的分批落地顺序

| 批 | 内容 | 验收点 |
|---|---|---|
| P0 | `gen-placement-fix.js`（修 B2/B3）+ `--fix-desc --fix-age`（修 B1/B4） | 45 条重复 desc 清零；青楼女子进 qinglou |
| P1 | A 层 40 人画像（人工精写 + 校验器） | §3.4 的 L0~L5 全部能在游戏里看到 |
| P2 | `look` 拼 `routine` + `talk` 拼 `catchphrase` + ask 自动注册（改 `world.js` / `commands.js`） | L0/L1/L2 三露出层上线 |
| P3 | B 层 90 人 | 重复率报告合格 |
| P4 | C 层 190 人 | 总量 320 覆盖 100% |
| P5 | `打听` 指令 + 传闻系统（交付 2） | L3 层上线 |

---

## 6. 验收标准（可勾选）

- [ ] 320 个 NPC 全部有 `portrait.v === 1`
- [ ] A 层 40 人、B 层 90 人、C 层 190 人，人数误差 ≤ 2
- [ ] A 层 40 人中具名 NPC ≤ 20 人
- [ ] 14 个门派各有 ≥1 名 A 层；9 个常驻区域各有 ≥1 名 A 层
- [ ] 校验器 8 项全过，失败条目 0
- [ ] 45 条重复 desc 归零，女性 NPC 不再出现"汉子"
- [ ] 9 个 courtesan 全部落在 `qinglou` 区域
- [ ] `look` 能看见 routine 动作；`talk` 能听见口头禅；`ask` 能问出来历与欲望
- [ ] `pstate` 随存档 round-trip：解锁 secret → 存 → 读 → 仍为已解锁
