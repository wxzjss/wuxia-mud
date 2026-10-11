# 主线三~五幕 + 第一幕夜戏落地（E5–E16）· 批次报告

> 批次号：MAINLINE-35-LAND　日期：2026-10-10 深夜
> 上一条提交：`05e3bd4`（线上同版本，版本戳 `20261010t`）
> 依据：`design/21-mainline-act3-5.md` **§8 落地清单 E1–E19** + `design/24-mainline-script.md` 逐字文案
> 起因：`design/36-md-audit.md` 体检发现 **E5–E16 基本未做**（此前被误判为「已落地」，见 `design/23` 引文）
> 分工报告：`design/37-act3-report.md`（第一幕夜戏 + 第三幕）· `design/38-act45-report.md`（第四~五幕 + 三结局）

---

## 0. 一句话结论

**E5–E16 全部落地**，落在两个**独立数据文件**里（靠「`NN_*.json` 后加载 + 深合并」覆盖既有字段，
不散改 `40_npcs.json` / `50_map.json` / `60_quests.json`）：

- `game/data/65_mainline_act3.json`（42 KB）—— 第一幕夜戏 + 第三幕
- `game/data/66_mainline_act45.json`（59 KB）—— 第四幕 + 第五幕 + 三结局

**顺带挖出并修掉 3 个系统级 bug**（其中一个是**本批之前就存在、影响所有房间**的老 bug），
新增一套 136 项验收测试，**6 处变异自证全部当场抓住**，**全量 60 套回归全绿**。

---

## 1. 逐项对照（E5–E16）

| 项 | 内容 | 状态 | 落地位置 |
|---|---|---|---|
| **E5** | C3 门槛后移（`q_main_jianghu.stages[3].cond` 加 `act4_done`）+ 三条奖励搬离 | ✅ | `60_quests.json`（主理人亲做） |
| **E6** | 第一幕夜戏「夜宿山道」（拦 / 退 两支，含 `menu` 抉择 + `combat`） | ✅ | `65` → `rooms.road_huashan_1` |
| **E7** | 新增 NPC 任我行（含 `bossPhases` + A 层 13 字段 `portrait`） | ✅ | `66` → `npcs.ren_woxing` |
| **E8** | 武林真意·残卷 / 抄本（`desc` 写明「残缺，只够看半篇」） | ✅ | `66` → `items` |
| **E9** | 三幕 4 件物品（半卷抄本 / 伪秘籍 / 假账册 / 解药） | ✅ | `65` → `items` |
| **E10** | 血刀老祖 / 丁春秋 补 `bossPhases`（`at` 严格递减 + `lifesteal`/`summon`） | ✅ | `65` → `npcs` |
| **E12** | 腰牌三条来路（**③ 位置有修正**，见 §3-D1） | ✅ | `66` → `palace_street` / `palace_road` / `jn_yamen_office` |
| **E13** | `q_main_snow`(7 段) / `q_main_moye`(6 段) / `q_main_end`(6 段) | ✅ | `65` / `66` → `quests` |
| **E14** | 方证 / 东方不败 / 女皇 三人 `quests` 数组挂任务（**写全量，防数组 replace 冲掉**） | ✅ | `65` / `66` → `npcs` |
| **E15** | **32 个房间 action**（三幕 14 + 四幕 8 + 五幕 10） | ✅ | `65` / `66` → `rooms` |
| **E16** | 三结局（交卷 / 拒交 / 半交）+ `menu` 门控（**拒交追加「收场」续场**，见 §3-D2） | ✅ | `66` → `palace_hall` |

> **E15 计数说明**：`design/21 §8.5` 写「合计 32 个」= 三幕 13 + 四幕 8 + 五幕 10 + 一幕 1。
> 实际落地 32 个（三幕那 13 个 + 夜戏 1 个 = 14 个 action 挂在 14 个房间上）。

---

## 2. ★ 本批挖出并修掉的系统级 bug（这才是最大的收获）

### 2-1 🔴 `look <人名>` 被房间 action 的 `keywords` 劫持（**老 bug，全库性**）
- **现象**：`smoke-portrait-batch` 的 `1.L0b` 报「`look 鲁半夏` 看不到 role」。
  实测输出是 `劝她` action 的 `failMsg`「她不在花厅。这条路的事，还轮不到你插嘴。」
- **根因**：内置 `look` 的兜底分支（B6 为「看告示」加的）匹配条件是
  `a.cmd === kw || keywords.some(k => kw === k || kw.includes(k))` —— **太贪**。
  只要某条 action 的 keywords 里含一个人名（`劝她` 有「鲁半夏」、`talk 元怀瑾` 有「元怀瑾」），
  该房间里 `look <那个人>` 永远被吃掉，**不报错、只是静默走错路**。
- **实证是「本批之前就有」**：`jn_yamen_court` 的 `look 元怀瑾` 在改动前同样返回
  「你细看了看，此处暂无更多可看的了。」（不是人物面板）。
- **修法**（`commands.js` 内置 `look` 兜底分支）：**参数能命中本房间 NPC 时，关键词不当场接管**；
  `a.cmd === kw`（按钮发的是 `a.cmd`）与「action 自己就是 look 系」仍优先。
- **修后**：`look 元怀瑾` → 人物面板（含 role 一行）；`look 鲁半夏` → 人物面板；
  `smoke-portrait-batch` **373/0**。

### 2-2 🔴 B29 `favor:<npcId>` 效果是 no-op（连累 262 条支线奖励）
- **根因**：`World.getNpc` **同名两处定义、后者覆盖前者**，实际查的是 `instances.npcs`
  （键是 `npc_xxx` 实例 id）。效果数据里写的却是 **defId** → `if (npc)` 静默 false。
- **修法**：新增 `World.findLiveNpc(defId)`（① 现存实例 id 兼容 → ② 按 defId 跨房间找活实例 →
  ③ 仍没有才 `spawnNpc` 到他的 `room`），`modapi.js` 的 `case 'favor'` 改用它。
- **实测自证**：`favor:master_yue:8` → 旧写法 `getNpc('master_yue') = null`；
  新写法取到岳不群实例，favor `-3 → 5`（Δ=8）。

### 2-3 🟠 B26 死成就
- `achievements.jianghu_end` 读 `ending_jianghu_end`，而该 flag 自 E4 摘 `ending` 后**永不置位**。
- **修法**：改读 `flagsAny: [ending_jiaojuan, ending_jujiao, ending_banjiao]`（三结局任一即得）。

### 2-4 🟠 E3 主线依赖一个「官方示例 mod 里的 NPC」
- `LEGEND_IDS = ['emei_miejue','taixu_hermit','shenni']`，而 **`taixu_hermit`（太虚居士）
  只活在 `mods/demo_skill/mod.json` 里**，基础数据里没有，且 `tier` 缺失。
- 现在能走到（示例 mod 默认启用），但**一关 mod，主线文案就变成「去找一个不存在的人」**。
- **处理**：给 `taixu_hermit` 补 `tier: "A"`；并在 `smoke-mainline35` §⑩ 加**硬断言**
  「名单里的人全都在世界里」，附注它的 mod 来源 —— 将来谁挪走它，测试立刻红。

---

## 3. 与设计稿的偏离（4 处，全部有理由）

| # | 偏离 | 理由 |
|---|---|---|
| **D1** | 腰牌来路③ `palace_prison`「问夏承志」→ 落在 **`palace_road`** | 夏承志是被押的人，玩家在**御道**遇见他才合逻辑；`palace_prison` 是牢房内侧，进去就说不通了 |
| **D2** | 拒交结局追加一条 **`palace_hall`「收场」** action | **引擎没有「战斗失败」分支效果**（`evalEffects` 是同步的，`combat` 只 `startCombat` 就返回）。「拒交 → 打起来 → 输了」这条只能另开一个能收尾的入口 |
| **D3** | Boss「打赢才置 `_down` flag」改为 **`killed_<boss>` 门控** | 引擎在 `onNpcDown` 自动置 `killed_<defId>`，等价且已支持 |
| **D4** | `menu` 选项**只能挂字符串 effect**，2 项「条件/增益」未落地 | `menu` 由字符串生成、选项 effect 按 `;` 拆后逐条字符串解析，嵌不进条件 |

---

## 4. 测试与验收

### 4-1 新增 `tools/smoke-mainline35.js`（**136 项 / 0 失败**）
十三个小节，重点守三类**会静默失效**的东西：
1. **数组 replace 语义**（§⑤）—— 新文件重声明房间的 `actions` 会**整段覆盖**。
   做法：把 `game/data` 除 65/66 外整份拷到临时目录，**用同一套加载器**跑一遍当基线，
   再断言「既有 cmd 一条不少」（这是唯一能证明没被吃掉的办法）。
2. **flag 闭环**（§⑥）—— `cond` 读到的 flag，必须**真有地方能置位**；
   递归解析 `{type:'cond',then,else}` 与 `menu` 的 raw 字符串（101 处 cond 全过）。
3. **id 真实性**（§⑩）—— 名单/物品/房间/NPC 引用一律断言存在。

另有 §⑦ E5 契约、§⑧ 腰牌三来路、§⑨ 三结局、§⑪ B29、§⑫ B26、§⑬ cond 可解析。

### 4-2 变异自证（**6 处，全部当场抓住、逐字节还原**）
| 变异 | 打在哪 | 结果 |
|---|---|---|
| M1 | 把既有 action 的 cmd 改一个字母 | ✅ 红「既有 action 一条都没丢」 |
| M2 | 把某个 flag 拼错 | ✅ 红「cond 读的 flag 全都有地方置位」 |
| M3 | 把铜牌塞回第一幕 rewards | ✅ 红「rewards 里已无 depot_token_half」 |
| M4 | `findLiveNpc` → `getNpc`（回退 B29） | ✅ 红「favor 真加到实例上」 |
| M5 | 回退 B26 死成就 | ✅ 红「不再读 ending_jianghu_end」 |
| M6 | 名单里写一个不存在的 NPC | ✅ 红「名单里的人全都在世界里」 |

### 4-3 全量回归
**60 套全绿 / 0 红**（排除 `patch-*` / `fix-*` / `gen-*` / `mutate.js` / `map-snapshot.js` 等**写入型**脚本）。

顺带按新契约更新了 4 套既有测试：
- `smoke-mainline.js`（37/6 → **48/0**）：`defeatLegend` 的 cond 变成 `and` 嵌套 + 需 `act4_done`，
  老断言只认顶层 `fn` → 整段静默跳过（假绿）。改用 `hasLegendCond()` 递归识别。
- `smoke-quest-data.js`（30/3 → **34/0**）：同一口径 + E5 契约断言反转。
- `smoke-act2.js`（142/1 → **143/0**）：悬空 flag 扫描器**只递归对象、不解析字符串**，
  把 `menu` 里置的 flag 全漏掉 → 假报悬空。修法：字符串先判、解析 `flag:`/`setflag:`。
- `smoke-boss.js`（82/2 → **85/0**）：它把 `blood_saber` 当「普通 NPC」测，
  而本批给他加了 `bossPhases` → 改成**从库里现挑一个真没有 bossPhases 的 NPC**。
- `identity-check.js`（46/2 → **48/0**）：门派 NPC 计数 15 → 16（新增任我行）+ 补 `rank`。

---

## 5. ⚠️ 本批的失误（如实记）

1. 🔴 **跑全量回归时把写入型脚本当测试跑了** —— `patch-npc-wickedness.js` / `patch-skills-category.js` /
   `patch-traits-items.js` / `map-snapshot.js` 这些**会改数据文件**的脚本被一并执行，导致
   `40_npcs.json`（整份重排缩进）、`50_map.json`（整份重排）、`00_core.json`（文案改回 AI 腔）、
   `10_skills.json`（功法分类被改）被污染。
   **教训：回归清单必须按「写不写文件」筛，不能按 `*.js` 一把抓。** 已改为显式排除清单。
2. 🔴 **`git checkout -- <file>` 在 `core.autocrlf=true` 下会把 LF 变 CRLF** ——
   第一次还原后 `smoke-portrait-batch` 反而更红（字节不可复原）。
   **正解：`git cat-file blob HEAD:<path> > <path>`**（取仓库里的原始字节）。
3. ⚠️ **子任务越界**：交办时明确「只允许新建 65/66」，三幕那边仍改写了 `60_quests.json`
   并**回滚了已落地的 E5**。已用 blob 原文 + 重放三处改动修回。
   **教训：边界要求要写进「自验脚本会去查什么」里，光写一句话不管用。**

---

## 6. 仍未做（引擎能力缺口，不是数据没写）

| 缺口 | 影响 |
|---|---|
| **`combat` 无胜负分支**（`evalEffects` 同步） | 设计里 4 处「打赢/打输」分叉只能降级：摸哨「打输被押进前庭」、第三幕 3-5 转场、拒交结局全靠另开 action |
| **`menu` 选项不能嵌条件** | 「半交」只能做纯选项，无法带条件/增益 |
| `design/05-balance-spec.md` **文件不存在** | 三~五幕的 exp/pot/难度、绝学获取曲线(E19) 仍无权威数值 |

> 🔴 **勘误（2026-10-10 深夜）**：本文初稿写「`hk_*` 52 条画像支线仍未落地」——**是错的**。
> 它们实际写在 `61_sidequests.json`，实测 **52 条全部在库、26 位 NPC 挂载、悬空 flag = 0**。
> 误判原因：只 grep 了 `60_quests.json`。**见 `design/36` §4.2 的更正与教训。**

---

## 7. 下一步建议

1. **补 `design/05-balance-spec.md`**（E19）——三~五幕已可玩，数值底盘不该再拖。
2. **给引擎补 `combat` 的 `onWin`/`onLose`**（或 `menu` 选项嵌条件）——可以一次解锁上面 4 处降级写法。
3. **#112 画像补员**（A 15→40 含反面形象 / B 24→60）。
4. **发布** —— 本批（三~五幕 + 夜戏 + 3 个系统级修复）已全绿，等主人点头。

---

*本报告与 `design/37` / `design/38` 是一套：本文是主理人视角的批次汇总，那两份是逐项落地明细。*
