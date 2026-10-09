# 《动态世界与传闻系统规格》

版本 v1.0 · 设计策略师 · SPRINT1-DESIGN-01 · 交付 2

> 配套交付 1（`01-npc-portrait-spec.md`）。画像给 NPC "里子"，本规格给世界"流动"。
> 已核对的真实底盘：`world.js#fireEvent`（`data.events[name]` 按 hook 名取）、`modapi.js#evalCond/evalEffects`、
> `world.js#mergeData`（`events` 在 collections 里，**按 id 合并，数组 arrayMode='replace'**）、
> `clockMinutes`（日 = floor/1440，季 = floor(日/30)%4，即 30 天一季、120 天一年）、
> 619 房间跨区域出口实测 **46 对**（见 §1.4）。

---

## 0. 一句话结论

当前世界是**静态的**：NPC 有性格有心情有日程，但玩家做的事**不留痕迹**——杀了人不被人知道，救了人也没人念好。江湖味的一半来自"我做过的事世界记得"。

本规格补三件事：**传闻（玩家行为 → 世界记忆）**、**事件库（世界自己会出事）**、**势力消长 + 日历（世界会随时间变）**。

---

## 1. 传闻系统

### 1.1 数据结构

存两份：**模板层**（数据文件，静态）与**运行期层**（`world.rumors`，随档）。

**模板层**（`70_world.json` → `rumorSeeds`）

```json
"rumorSeeds": {
  "rs_kill_named": {
    "id": "rs_kill_named",
    "kind": "杀人",
    "polarity": -1,
    "weight": 3.0,
    "heat0": 85,
    "tauDays": 6,
    "ttlDays": 20,
    "loud": true,
    "texts": {
      "true":  "听说{who}在{where}把{whom}给结果了，一招都没还手。",
      "half":  "风声说{where}出了人命，动手的好像是{who}。",
      "false": "你听说了吗？{who}在{where}连伤七条人命，那剑使得跟鬼似的！"
    },
    "marks": ["血案"]
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | enum | 传闻种类，见 §1.2 表 |
| `polarity` | int | −1 恶名 / 0 中性 / +1 善名 |
| `weight` | float | 名声权重，0.5~4.0 |
| `heat0` | int 0~100 | 初始热度 |
| `tauDays` | float 天 | 热度衰减时间常数 |
| `ttlDays` | int 天 | 硬生存期，到期强制删除 |
| `loud` | bool | 是否"响动大"——决定相邻房间的人是否算目击者 |
| `texts` | object | 三档说法模板：`true`(真实度≥70) / `half`(40~69) / `false`(<40) |
| `marks` | array | 便于 `打听` 按话题检索 |

**运行期层**（`world.rumors`，数组，必须进 `serialize()`）

```json
{
  "uid": "r_00017",
  "seedId": "rs_kill_named",
  "subject": "player",
  "about": "npcv_181",
  "text": "听说那姓蒋的剑客在嵩山道把个过路的给结果了……",
  "truth": 62,
  "originRoom": "road_shaolin_1",
  "originRegion": "shaolin",
  "bornDay": 41,
  "heat": 85,
  "spread": { "shaolin": 100, "jiangnan": 34, "market": 12 },
  "witnesses": ["npcv_013", "npcv_197"],
  "hopCount": 2,
  "vars": { "who": "蒋停舟", "where": "嵩山道", "whom": "一个过路的" }
}
```

### 1.2 玩家行为 → 传闻种子（目击表）

**目击者判定**：
- 同房间内所有 `hostile === false` 且非 `knockedOut` 的 NPC → 必为目击者。
- 若 `loud === true`，**相邻房间**（沿 `exits` 一跳）的 NPC 有 50% 概率成为目击者。
- 夜里（`world.isNight()`）目击概率 × 0.5；雨天 × 0.7。
- **目击者数为 0 则不生成传闻**（无人看见 = 无人可传，避免"全江湖都知道你在无人区干了什么"的不真实感）。

| 玩家行为 | seedId | kind | polarity | weight | heat0 | tauDays | loud |
|---|---|---|---|---|---|---|---|
| 击杀具名 NPC / 门派弟子 | `rs_kill_named` | 杀人 | −1 | 3.0 | 85 | 6 | ✓ |
| 击杀普通百姓 | `rs_kill_civilian` | 杀良 | −1 | 4.0 | 95 | 8 | ✓ |
| 偷窃被当场发现 | `rs_theft_caught` | 偷窃 | −1 | 1.5 | 55 | 2 | ✗ |
| 当街拒捕 / 打伤捕快 | `rs_resist_arrest` | 抗官 | −1 | 2.5 | 80 | 5 | ✓ |
| 救人一命（救下被袭 NPC） | `rs_save_life` | 救人 | +1 | 2.0 | 60 | 5 | ✗ |
| 资助乞丐 / 施粥 | `rs_alms` | 行善 | +1 | 0.8 | 30 | 3 | ✗ |
| 夺得门派大比头名 | `rs_tournament_win` | 扬名 | +1 | 3.5 | 90 | 12 | ✓ |
| 加入 / 叛出门派 | `rs_sect_join` / `rs_sect_betray` | 门派 | ±1 | 2.5 | 75 | 10 | ✓ |
| 赊账不还（超过 30 天） | `rs_deadbeat` | 失信 | −1 | 1.0 | 40 | 4 | ✗ |
| 当众退婚 / 休妻 | `rs_break_marriage` | 风评 | −1 | 1.5 | 50 | 5 | ✗ |
| 揭穿某人秘密（交付 1 的 `secret`） | `rs_secret_out` | 揭私 | −1 | 2.0 | 70 | 4 | ✓ |
| 独闯秘境生还 | `rs_dungeon_clear` | 奇遇 | +1 | 2.5 | 70 | 9 | ✗ |
| 连续三日宿醉 | `rs_drunkard` | 市井 | 0 | 0.5 | 25 | 2 | ✗ |
| 高价拍下某物（> 500 两） | `rs_bigspender` | 豪客 | 0 | 1.0 | 45 | 3 | ✗ |
| 被官府下狱又越狱 | `rs_jailbreak` | 重案 | −1 | 4.0 | 100 | 15 | ✓ |

**种子里的 `{who}` 一律填玩家姓名；`{where}` 填房间名（`50_map.json` 的 `rooms[id].name`）；`{whom}` 填受害人姓名。** 这三段变量由目击时的上下文直接填，不做模板推断。

### 1.3 扩散算法（按区域 / 时间衰减）

**每日结算一次**（挂在新增 hook `onDayTick`，见 §2.2），对每条活跃传闻执行：

**① 热度衰减**

```
heat(t) = heat0 × exp(−Δt / tauDays)        单位：Δt 天
```

**② 区域强度衰减 + 邻区扩散**

```
S[r] ← S[r] × exp(−1 / tauDays)                          // 本地遗忘
for each 邻区 n of r (按 §1.4 的 region 邻接表):
    S[n] ← min(100, S[n] + S[r] × k_flow(r) × DIFFUSE)   // DIFFUSE = 0.35
```

**`k_flow(r)` = 区域人口流动系数**，用现有 `tag` 实测统计：

```
k_flow(r) = clamp( N_flowy(r) / N_total(r), 0.15, 0.60 )
N_flowy = 该区域 tag ∈ {merchant, escort, boatman, vendor, groom, beggar} 的 NPC 数
```

> ⚠ **实测发现的坑**：按上式算，`yamen`(0.00)、`qinglou`(0.00)、`shuyuan`(0.00)、`cunzhen`(0.00)、`farmland`(0.00)、`palace`(0.00)、`dali`(0.00)、`mojiao`(0.00)、`xixia`(0.00)、`gusu`(0.00) 的流动系数全是 0——这些区域一个流动人口都没有，传闻**永远传不进来也传不出去**。
> **所以 `clamp` 的下限 0.15 是硬性的，不能取 0。** 另外：衙门与青楼恰恰是"消息最灵通"的地方，建议在 `k_flow` 里给 `yamen` 与 `qinglou` 各加 **+0.20 的固定修正**（官面上的事传得快、枕边话传得快），修正后再 clamp。
> 实测参考值：`jiangnan` 0.37 / `taohuadao` 0.40 / `xiyu` 0.80 / `harbor` 1.00（截断到 0.60）/ `huashan` 0.29 / `market` 0.18。

**③ 走样（每跳一次）**

```
每向邻区扩散一跳：truth ← clamp(truth + rng(−8, +8), 0, 100)
                  hopCount += 1
```
`truth` 决定 `texts` 用哪一档模板（≥70 / 40~69 / <40）。**模板文本在生成传闻实例时固化一次**，之后不再重算——否则玩家打听两次会得到不同说法，像 bug。

**④ NPC 知晓判定**（玩家打听时才算，不预计算）

```
NPC n 知晓传闻 R  ⟺  rng() < 1 − (1 − p0)^(S[region(n)] / 20)
p0 = 0.12 × curiosity(tag(n))

curiosity: vendor / beggar / waiter / waiter2 / innkeeper / madam / gambler = 1.5
           monk / taoist / nun / official / palace = 0.5
           其余 = 1.0
```
理由：嘴碎的摊贩最先知道，方外之人与官面上的人最后知道。

**⑤ 消亡**

`max(S) < 5` 或 `当前日 − bornDay > ttlDays` → 从 `world.rumors` 删除。
同时约定：`world.rumors` 长度上限 **200 条**，超出先删最旧的。

### 1.4 区域邻接表（必须预计算，不能运行时 BFS）

实测：619 房间跨区域出口共 **46 对**（双向去重后）。运行时每次扩散都 BFS 一遍地图太贵，**必须预计算成静态表**。

落地：`tools/gen-region-graph.js` 扫 `50_map.json` 的 `exits`，产出 `50_map.json.meta.regionAdj`：

```json
"regionAdj": {
  "jiangnan": { "wild": 6, "market": 4, "shuyuan": 4, "palace": 4, "yamen": 2,
                "qinglou": 2, "huashan": 2, "mojiao": 2, "farmland": 2,
                "secret": 2, "cunzhen": 2, "gusu": 2, "haitan": 2, "gaibang": 2 },
  "market":  { "jiangnan": 4, "yamen": 4 },
  ...
}
```

权重 = 双向出口数之和。**权重只用于"是否存在通路"的判定与随机选路，不参与强度计算**（强度只由 `k_flow` 决定），避免大区域碾压小区域。

### 1.5 玩家怎么打听到

**复用现有 `ask` + 新增一条 `打听` 指令。**

| 入口 | 输出 |
|---|---|
| `打听 <人名/门派/关键词>` | 在当前 region 的活跃传闻里按 `vars` 值 + `marks` 匹配，最多列 3 条；每条由**一名知晓该传闻的 NPC** 说出口 |
| `ask <npc> 关于 <人名>` | 若该 NPC 知晓 → 说出该条传闻的对应档位文本；不知晓 → 走 `askDefault` |
| `look` 在茶馆/酒楼/市集 | 概率飘一句"邻桌正在议论……"（只给 `heat ≥ 60` 的传闻，避免刷屏） |

**说法渲染三段式**（工程侧照做）：

```
{前缀动作，按 npc 的 voice.tone}
  + {texts[truth档]，变量已替换}
  + {态度后缀，按 该NPC 对 subject 的 rel.kind}
      亲 → "（他压低了声音）这话我只跟你说。"
      友 → "依我看，{subject}不是那样的人。"
      仇 → "哼，{subject}那种人，早晚有报应。"
      无关系 → "我也是听人说的，作不得准。"
```

### 1.6 传闻 → 名声

现有 `p.reputation` 是按门派名的对象（`commands.js:1518` 用它算商店折扣，`modapi` 的 `rep` 条件读它）。**不新增字段，直接汇入它**。

```
每次传闻实例生成时一次性结算（不是持续结算，避免重复计分）：
Δrep[key] = polarity × weight × (heat0 / 100)

key 取值：
  · 事件发生在某门派地盘（room.region 对应 sect.region）→ 该门派名
  · 事件涉及某门派弟子 → 该门派名
  · 否则 → "*"（现有代码里 "*" 已用于"全江湖声望"）
```

**新增 `p.fame`（对象，key = region id）**：记录玩家在各地域的知名度，供"官府缉拿"和"门派邀约"事件读。

```
fame[region] += heat0 / 100 × 10    （每日结算时按当前 S[region] 累加一次）
```

**与 karma 的关系**：`karma` 是正邪数值，由杀戮累积；`reputation` 是各家门派/江湖的观感；`fame` 是知名度。**三者互不影响**——一个恶名昭彰的大魔头 fame 极高但 reputation 极低，这正是江湖味。

---

## 2. 随机事件库（从 4 条扩到 60+ 条）

### 2.1 现状与硬约束

实测：`60_quests.json` 的 `events` 只有 4 个 hook：`onLevelUp`(1 条) / `onKill`(2 条) / `onEnter`(空) / `onTick`(有内容)。

`world.js#fireEvent(name)` 取 `this.data.events[name]`，而 `events` 在 `mergeData` 的 `collections` 列表里，**按 id 做 `mergeEntry` 合并，`arrayMode = 'replace'`**。

> ⚠ **因此有两条硬规则（工程侧务必遵守，否则静默丢数据）**：
> 1. **新增 hook 名**（如 `onDayTick`）→ 可以在新文件 `70_world.json` 里建，安全。
> 2. **往已有 hook（`onTick` / `onKill` / `onEnter` / `onLevelUp`）追加条目** → **必须直接写进 `60_quests.json` 的对应数组里**。若在新文件里写同名 hook，数组会被 `replace` 整体覆盖，现有条目全丢。

### 2.2 需要新增的 hook（world.js 加 fireEvent 调用点）

| hook | 触发位置 | 用途 |
|---|---|---|
| `onDayTick` | `world.js` 每次 `clockMinutes` 跨过 1440 的倍数时（在 `tick()` 里判定） | **60+ 条随机事件的主挂载点** |
| `onSeasonChange` | `season()` 返回值变化时 | 季节事件（蝗灾、雪封山） |
| `onHoliday` | 日历命中节庆日（§4） | 年节事件 |
| `onRumorBorn` | 传闻实例生成后 | "消息传开了"的连锁反应 |
| `onRumorHeat` | 某传闻 `heat ≥ 80` 且 `subject === player` | 官府缉拿 / 仇家找上门 |
| `onFactionTick` | 每 30 天（每月） | 势力消长结算（§3） |
| `onEnterRegion` | 玩家跨 region 移动时（`world.js#move`，比对前后 `room.region`） | 地域事件、通缉盘查 |

**为什么必须新增 `onDayTick` 而不是都塞 `onTick`**：`onTick` 每推进一次时间就跑一遍，60+ 条 × 每刻 × 每个 `chance` 判定，既烧性能又让"低概率事件"实际频率失控。每日一次是正确粒度。

### 2.3 事件标准结构

```json
{
  "id": "ev_debt_collector",
  "cat": "市井琐事",
  "name": "催债的上门",
  "cond": {
    "and": [
      { "region": "market" },
      { "var": "has_debt", "op": ">=", "value": 1 },
      { "chance": 0.25 }
    ]
  },
  "effects": [
    "me:一个横眉竖眼的汉子堵在你面前",
    "say:欠我们东家的三十两，今天该还了吧？",
    "menu:怎么应答:还钱>-money:30|flag:paid_debt|say:他掂了掂银子，走了。>硬扛>combat:mob_bandit>打死他>-karma:15"
  ],
  "target": { "marks": ["债"] },
  "once": false,
  "cooldownDays": 7
}
```

| 字段 | 说明 |
|---|---|
| `cat` | 8 大类之一（§2.4） |
| `cond` | 直接用 `modapi.js#evalCond` 支持的语法：`region / season / time / day / chance / flag / var / rep / karma / and / or / not`。**不新增条件语法** |
| `effects` | 直接用 `modapi.js#evalEffects` 的字符串 DSL（`say: me: menu: combat: +rep: flag: spawn: goto: +item:` 等）。**不新增效果语法** |
| `target` | 可选，按 `portrait.marks`（交付 1）筛选被卷入的 NPC |
| `once` | 是否终生只触发一次 |
| `cooldownDays` | 冷却天数，防刷 |

### 2.4 分类配额（合计 68 条）

| # | 类别 | 条数 | 典型触发条件 | 可观测后果 |
|---|---|---|---|---|
| 1 | **江湖恩怨** | 12 | 玩家 `fame ≥ 30`；仇家 NPC 存活；`karma` 越界 | 仇家带人堵路、下战书、半夜放火、托人递话约架 |
| 2 | **官府缉拿** | 8 | `fame[region] ≥ 40` 且 `karma ≤ −30`，或有 `rs_kill_named` 类传闻 heat ≥ 70 | 捕快盘查、画影图形通缉、悬赏告示、下狱（复用现有 `world.jail`） |
| 3 | **天灾饥荒** | 6 | `season` 命中；`region ∈ {farmland, cunzhen}` | 蝗灾减产、河堤决口、流民入城（spawn refugee）、粮价翻倍 |
| 4 | **秘境现世** | 6 | `day % 30` 命中；玩家 `realm ≥ 3` | 思过崖后洞开启、古墓现世、剑冢出土、藏经阁失窃 |
| 5 | **门派纷争** | 10 | `onFactionTick` 后势力关系 < −40 | 两派械斗、弟子下山挑衅、掌门换人、镇派之宝失窃 |
| 6 | **市井琐事** | 12 | `region ∈ {market, jiangnan, cunzhen}`；无条件低概率 | 催债、斗殴、失窃、说书、斗鸡、媒婆说亲、孩童走失、醉汉闹事 |
| 7 | **商路货殖** | 8 | `region ∈ {harbor, market}` 或官道 | 镖银被劫、商队遇匪、货价波动、走私被发现、船期延误 |
| 8 | **边关烽火** | 6 | `region ∈ {beijiang, xiyu, xixia, jinguo}` | 边军征丁、胡骑南下、烽火台举烟、边市关闭 |

**合计 68 条**，其中 20 条为"必触发型"（`once:true`，剧情锚点），48 条为"随机型"（带 `chance` + `cooldownDays`）。

### 2.5 完整示例（8 条，每类 1 条）

```json
{ "id":"ev_foe_ambush", "cat":"江湖恩怨", "name":"仇家堵路",
  "cond":{ "and":[ {"var":"foe_count", "op":">=", "value":1}, {"chance":0.15} ] },
  "effects":["me:路当中站着几个人，挡住了去路",
             "say:姓{player}的，我寻你三个月了。",
             "menu:如何:拔剑>combat:mob_bandit_chief|讲理>-rep:*:5|转身就走>-rep:*:-8],
  "cooldownDays":10 }

{ "id":"ev_wanted_poster", "cat":"官府缉拿", "name":"画影图形",
  "cond":{ "and":[ {"region":"jiangnan"}, {"karma":"<=-30"}, {"chance":0.3} ] },
  "effects":["say:城门口新贴了告示，画上的人眉眼竟有几分像你。",
             "flag:wanted_jiangnan", "+rep:朝廷:-20"],
  "once":false, "cooldownDays":30 }

{ "id":"ev_locust", "cat":"天灾饥荒", "name":"蝗灾",
  "cond":{ "and":[ {"season":"summer"}, {"region":"farmland"}, {"chance":0.12} ] },
  "effects":["say:天边飞来一片黄云，落到地里才知道是蝗虫。",
             "var:grain_price=3", "flag:famine_year"],
  "once":false, "cooldownDays":60 }

{ "id":"ev_siguya_open", "cat":"秘境现世", "name":"思过崖后洞",
  "cond":{ "and":[ {"room":"huashan_siguoya"}, {"flag":"know_siguya"}, {"chance":0.2} ] },
  "effects":["say:崖壁缝隙里透出一线光，里头似乎有石阶。",
             "flag:siguya_back_open", "+exp:300"],
  "once":true }

{ "id":"ev_sect_clash", "cat":"门派纷争", "name":"两派械斗",
  "cond":{ "and":[ {"var":"faction_tension_huashan_mojiao", "op":"<", "value":-40}, {"chance":0.2} ] },
  "effects":["me:山道上一伙人正打得难解难分",
             "spawn:mob_mo_disciple:road_huashan_1:3",
             "menu:帮谁:帮华山>+rep:华山派:20|帮魔教>+rep:日月神教:20|都不帮>-rep:*:3],
  "cooldownDays":20 }

{ "id":"ev_lost_child", "cat":"市井琐事", "name":"孩童走失",
  "cond":{ "and":[ {"region":"market"}, {"time":{"min":480,"max":1080}}, {"chance":0.08} ] },
  "effects":["say:一个妇人沿街哭喊，说她家伢子不见了。",
             "menu:管不管:帮着找>+karma:5|+pot:30|不管>-karma:2"],
  "once":false, "cooldownDays":5 }

{ "id":"ev_escort_robbed", "cat":"商路货殖", "name":"镖银被劫",
  "cond":{ "and":[ {"region":"gaibang"}, {"chance":0.15} ] },
  "effects":["me:官道上横着几辆车，箱笼已被撬开",
             "spawn:mob_bandit:road_nan_1:2",
             "menu:要不要管:出手>+karma:10|+rep:*:8|绕开>-karma:1"],
  "cooldownDays":15 }

{ "id":"ev_border_levy", "cat":"边关烽火", "name":"边军征丁",
  "cond":{ "and":[ {"region":"beijiang"}, {"chance":0.1} ] },
  "effects":["say:一队军汉挨户敲门，说朝廷要征丁。",
             "menu:如何应对:应征>flag:conscripted|goto:jinguo_ruin|躲开>-karma:3"],
  "cooldownDays":40 }
```

> 注：`menu:` 的 DSL 语法见 `modapi.js` 头部注释 `"menu:选单文本:optA>effA|optB>effB"`，示例里为可读性做了分行，实际写在一行。

---

## 3. 势力消长

### 3.1 数据结构（`70_world.json` → `factions`）

```json
"factions": {
  "huashan": {
    "id": "huashan", "name": "华山派", "kind": "门派",
    "align": "正道",
    "homeRegion": "huashan",
    "power": 62,
    "treasury": 3400,
    "territories": ["huashan"],
    "recruitThreshold": 0,
    "relations": { "mojiao": -70, "shaolin": 35, "wudang": 40, "朝廷": 20 },
    "mood": "守成"
  }
}
```

初值推导（不用手填，生成器算）：
- `power` 初值 = 该门派 NPC 数 × 2 + 掌门 `level` × 0.3，钳制 0~100。
- `relations` 初值按 `align`：`正道↔正道 = +40`，`正道↔魔道 = −60`，`魔道↔魔道 = −20`（互相也不对付），`↔朝廷`：正道 +20 / 魔道 −50 / 丐帮 0。
- 已实测门派 14 个：`huashan shaolin wudang emei gaibang tangmen mojiao wudu dali xingxiu gumu taohuadao xiake xuedao`。另加 2 个非门派势力：`朝廷`（官府/衙门）、`漕帮`（harbor/商路）。

### 3.2 月度结算公式（每 30 天，`onFactionTick`）

```
收入  I = Σ(territories) 税基(region) × (power/100) + 门派贡献（玩家 sectContribution 的 1%）
支出  E = 弟子数 × 8 + 战损（本月该门派 NPC 死亡数 × 40）
Δpower = clamp( (I − E) / 100 , −10, +10 ) + 事件冲击
Δtreasury = I − E
```

`税基(region)`：按区域内房间数 / 10 取整（`jiangnan` 184 → 18，`yamen` 14 → 1，`huashan` 11 → 1）。

**关系漂移**（每月）：
```
Δrelations[a][b] = −0.02 × (power_a − power_b)   // 强弱差越大越敌对
                 + 0.5 ×（本月 a 与 b 是否同阵营共同御敌）
```
钳制 −100~+100。

**地盘易主**：`power < 20` 且邻区势主 `power > 70` → 有 10% 概率失去一块 territory；反之 `power > 85` → 10% 概率吞并邻区。

### 3.3 可观测影响（**必须能被玩家看见，否则等于没做**）

| # | 影响面 | 具体表现 | 落地位置 |
|---|---|---|---|
| 1 | **收徒门槛** | `power < 30` 的门派放宽 `sect.require`（免 gender 限制）；`power > 80` 加试炼 | 门派入教判定 |
| 2 | **商店折扣** | 本派 `power` 越高，本派地盘商店折扣越大（现 `commands.js:1518` 已有 reputation 折扣，叠加一层） | `commands.js` buy |
| 3 | **巡卫密度** | `朝廷 power` 高 → 官道 `respawn` 里 `guard_city`/`mob_soldier` 的 `count` +1 | `50_map.json` respawn（运行期不改数据，改 spawn 数） |
| 4 | **NPC 对话** | 本派弟子 `talk` 台词按 `mood`（守成/进取/窘迫/报复）切换一组 | `talk` 渲染时查 `faction.mood` |
| 5 | **任务可接性** | `relations[a][b] < −40` 时解锁"离间/挑拨"类任务；`> 60` 时解锁"同盟"类 | quest 的 `cond` 加 `factionRel` 条件 |
| 6 | **地盘标识** | 进入 region 时 `look` 加一行"此处已是 XX 派的地盘" | `look` 渲染 |
| 7 | **弟子游荡** | `power` 高的门派，其弟子 NPC 会出现在官道上（schedule 临时改写） | `tick()` 里改写 `n.room` |

---

## 4. 时间轴与日历

### 4.1 现有时间底盘（实测，不要另起一套）

```
clockMinutes                  总分钟
day      = floor(clockMinutes / 1440)         第 N 天（modapi 的 "day" 条件是 +1）
season   = SEASONS[floor(day / 30) % 4]       30 天一季，120 天一年
isNight  = (clockMinutes % 1440) < 300 || >= 1140
isMealTime = 660~780 或 1020~1140
```

**沿用这套，不新增时间系统。** 日历只是"在 `day` 上查表"。

### 4.2 单位换算（写进文档，避免各系统各说各话）

| 单位 | 天数 | 说明 |
|---|---|---|
| 一日 | 1 | `day` |
| 一旬 | 10 | 盘账、发俸 |
| 一月 | 30 | 势力结算、门派大比 |
| 一季 | 30 | 春夏秋冬 |
| 一年 | 120 | 4 季 |
| 玩家一岁 | 120 天 | 实测 `p.age = 16 + floor(timeMinutes/1440/120)` |

### 4.3 节庆与周期大事表

| 日（day % 120） | 名称 | 事件 | 可观测 |
|---|---|---|---|
| 0 | 元日 | 官府开印、门派发年赏 | 各派 `treasury −200`，弟子 mood +20；衙门放假三日，捕快不见 |
| 15 | 上元 | 灯会（江南/洛阳/长安） | 街上 spawn 灯摊，贼窃事件概率 ×2 |
| 35 | 清明 | 扫墓 | 有 `丧亲` mark 的 NPC mood −25；坟茔区域可遇祭扫人 |
| 55 | 端午 | 龙舟（harbor） | harbor 区域赛事，可下注 |
| 70 | 七夕 | — | 未婚 NPC 成对出现；媒婆类任务概率 ×3 |
| 95 | 中秋 | 赏月 | 门派停战三日；`relations` 全部 +5 |
| 110 | 重阳 | 登高 | 山地区域（huashan/emei）奇遇概率 ×2 |
| 118~119 | 岁除 | 封印 | 官府不办案，通缉暂停 |

| 周期 | 名称 | 触发 | 内容 |
|---|---|---|---|
| 每季（day % 30 == 10） | 门派大比 | 各派本山 | 玩家可参赛，头名 → `rs_tournament_win` 传闻 + `+rep` 该派 50 |
| 每 2 年（day % 240 ∈ [60,63]） | **武林大会** | 少林 ↔ 武当轮值 | 全地图 NPC 向会场迁移；各派 `relations` 波动 ±15；期间无门派纷争事件 |
| 每 3 年（day % 360 ∈ [30,33]） | **科举** | 书院/皇城 | `scholar` 类 NPC 全部离城（schedule 改写为 changan）；书院空房；放榜后回来，中举者改 tag 为 `official` |
| 每年（day % 120 ∈ [50,52]） | 漕运开帮 | harbor | 商路事件概率 ×3，harbor 出现大量 `escort`/`merchant` |
| 每年（day % 120 ∈ [85,88]） | 秋汛 | farmland / cunzhen | 河堤决口事件窗口，粮价 ×2 |

### 4.4 日历数据结构

```json
"calendar": {
  "yearDays": 120, "seasonDays": 30, "monthDays": 30,
  "festivals": [
    { "day": 0,  "id":"yuandan", "name":"元日", "hooks":["onHoliday"],
      "effects":["say:城中爆竹声不断，家家户户贴了新联。","flag:holiday_yuandan"] },
    { "day": 15, "id":"shangyuan", "name":"上元", ... }
  ],
  "cycles": [
    { "id":"wulin_dahui", "name":"武林大会", "periodDays":240, "offset":60, "span":4,
      "venue":["shaolin_daxiong","wudang_zixiao"], "effects":[...] }
  ]
}
```

**判定**：每日 `onDayTick` 开头算 `d = day % 120`，查 `festivals`；再对每个 `cycles` 判 `day % periodDays ∈ [offset, offset+span)`。命中则 `fireEvent('onHoliday', {id})`。

---

## 5. 数据文件与落地顺序

### 5.1 新建 `game/data/70_world.json`（顶层 4 键）

```json
{ "rumorSeeds": {...}, "factions": {...}, "calendar": {...}, "worldEvents": {...} }
```

> ⚠ **键名必须是 `worldEvents` 而不是 `events`**。`mergeData` 会把 `events` 当 collection 按 id 合并，与 `60_quests.json` 的 `events` 撞车；且数组 `arrayMode='replace'` 会覆盖。用新键名 + 新增 hook 名（`onDayTick` 等）才安全。
> `loadBaseData` 自动扫 `NN_*.json`，新文件无需改加载逻辑。

### 5.2 运行期状态（必须进 serialize）

`serialize()` 需显式新增：

```js
rumors:    this.rumors,          // 活跃传闻
faction:   this.factionState,    // 势力运行值（与 data.factions 模板分离）
fame:      p.fame,               // 玩家地域知名度
calendar:  this.calendarState,   // 上次结算日、节庆触发记录
rumorSeq:  this.rumorSeq,        // uid 自增计数
```

`deserialize()` 对应恢复。**注意**：`data.factions` 是模板（不随档），`this.factionState` 是运行值（随档），两者分离，与交付 1 的 `def.portrait` / `npc.pstate` 是同一套思路。

### 5.3 落地顺序

| 批 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| W1 | `tools/gen-region-graph.js` → `meta.regionAdj` | 无 | 46 对跨区边全部有值 |
| W2 | `world.js` 加 `onDayTick` / `onEnterRegion` / `onHoliday` / `onRumorBorn` 四个 fireEvent 点 | 无 | 四个 hook 能被 `fireEvent` 取到 |
| W3 | `rumorSeeds` 15 条种子 + 目击判定 + 扩散算法 | W1 | 杀人后 3 日内邻区能打听到 |
| W4 | `打听` 指令 + 说法三段式渲染 | W3、交付 1 的 P1 | 打听得到 3 档说法且随 truth 变化 |
| W5 | `worldEvents` 68 条（先 `市井琐事` 12 条验收，再铺其余） | W2 | 无报错、不刷屏、冷却生效 |
| W6 | `factions` + 月度结算 + 7 条可观测影响 | W2 | 至少 3 条影响能被玩家直接看见 |
| W7 | `calendar` 节庆 + 周期大事 | W2 | 元日/武林大会/科举 各触发一次成功 |

---

## 6. 验收标准

- [ ] 杀一个具名 NPC 后，3 游戏日内在相邻区域能"打听"到该传闻
- [ ] 同一条传闻在不同 NPC 口中出现不同说法（truth 分档 + rel 态度后缀生效）
- [ ] 传闻会走样：传播 3 跳以上后 `truth` 与初始差值 ≥ 15
- [ ] 传闻会消亡：`ttlDays` 到期后 `world.rumors` 不再包含它
- [ ] 随机事件 68 条全部能被引擎解析，无 `evalCond` / `evalEffects` 报错
- [ ] 事件有冷却，同一事件 7 日内不会触发两次
- [ ] 势力结算后，至少 3 项可观测影响（收徒门槛 / 商店折扣 / 地盘标识）能验证
- [ ] 武林大会（day%240）与科举（day%360）各能触发一次
- [ ] `rumors` / `factionState` / `fame` 随存档 round-trip 不丢
