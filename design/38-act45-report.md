# 主线第四幕《黑木之崖》+ 第五幕《江湖路远》+ 三结局 · 落地报告（#114 工程）

> 执行人：工程执行（eng-act45）　日期：2026-10-10
> 规格：`design/21-mainline-act3-5.md`（§4 / §5 / §6 / §8 / §9）　逐字文案：`design/24-mainline-script.md`（四幕 6 场 + 五幕 6 场 + 三结局尾声）
> 交付物：**新建 `game/data/66_mainline_act45.json`**（唯一新建/修改的产品文件）+ 本报告
> 边界：**未 commit**；**未改** `40_npcs.json` / `50_map.json` / `60_quests.json` / `game/src/**`。

---

## 0. 一句话结论

第四幕 6 场、第五幕 6 场、三结局全部落地为真数据（**81 条自验断言全过**），
落在**单个新数据文件**里，靠引擎「`NN_*.json` 后加载 + 深合并」覆盖既有 NPC/物品/任务/房间字段。
**4 处与 team-lead 交办单/设计稿的偏离，全部在 §6 如实列出**——其中 2 处是「引擎根本没有这个能力」，
已按 team-lead 硬约束 #2「换成等价的已支持写法」处理。

---

## 1. 逐项对照表（E7 / E8 / E12 / E13 / E14 / E15 / E16）

| 交付项 | 规格要求 | 落地情况 | 数据位置 |
|---|---|---|---|
| **E7** 新增 NPC `ren_woxing` | §4.4 完整 JSON（含 `bossPhases`）+ A 层 `portrait`；`room:'mojiao_hall'` | ✅ 完整落地。`bossPhases` 3 阶段（`at` = 1 / 0.6 / 0.3 **严格递减**，phase0 `skill:'xixing_dafa'` 会自动预挂）；`portrait` 16 字段照 `depot_master` 同构 | `npcs.ren_woxing` |
| **E8** 核心物品 ×2 | `wulin_zhenyi_canjuan`（`book`/`noSell`/`tags:[mainline,clue,legend]`/`quality:legend`/**desc 含「残缺，只够看半篇」**）+ `wulin_zhenyi_chaoben` | ✅ 两件均落地；残卷 desc 含「残缺，只够看半篇」（自验断言） | `items.*` |
| **E8 可选** `yuanhuai_stub` | 可选 | ✅ 一并落地（供五幕捕快线凭证） | `items.yuanhuai_stub` |
| **E12** 腰牌三条来路 | 三条 action 均含 `+item palace_token` | ✅ 三条全部含 `+item:palace_token`（自验断言）。**地理位置③有偏离，见 §6-D1** | `rooms.palace_street/palace_road/jn_yamen_office` |
| **E13** `q_main_moye` | 6 段，giver `mojiao_dongfang`，`cond act3_done`，rewards 含 `know_depot_master`/`act4_done`/`quest[q_main_end,0]`/`+exp20000`/`+pot10000`/`+title 上崖人` | ✅ 6 段（自验），giver 正确，rewards 六项齐全 | `quests.q_main_moye` |
| **E13** `q_main_end` | 6 段，giver `nv_huang`，`cond act4_done`，rewards 含 三结局 flag/`act5_done`/`+exp30000`/`+pot15000`/`+title 名动天下` | ✅ 6 段（自验），giver 正确。三结局 flag 由 `ending` 效果按选择落（`rewards` 不再重复写三选一，理由见 §6-D5） | `quests.q_main_end` |
| **E14** 委托人挂任务 | `mojiao_dongfang.quests` / `nv_huang.quests` 各追加 | ✅ `mojiao_dongfang.quests=['q_main_moye']`；`nv_huang.quests=['q_taohua_entry','q_main_end']`（**写全量**，原有项未丢，自验断言） | `npcs.mojiao_dongfang/nv_huang` |
| **E15** 第四幕 8 个 action | §4.3 逐场 | ✅ 8 个全落地（见 §3 清单） | `rooms.mojiao_*/jn_brothel_hall` |
| **E15** 第五幕 10 个 action | §5.5 逐场 | ✅ 10 个全落地（腰牌③落 `palace_road`，见 §6-D1） | `rooms.palace_*/haitan_boat/taohuadao_*` |
| **E16** 三结局 | `palace_hall` 两 action 用 `menu` 门控「交卷/拒交/半交」，落三个 `ending_*` flag | ✅ 「面圣」2 选项（交卷/不交）、「面圣（带抄本）」3 选项（交卷/半交/不交）；`ending` 效果落 `ending_jiaojuan`/`ending_jujiao`/`ending_banjiao`。**拒交需追加一条续场 action，见 §6-D2** | `rooms.palace_hall` |

> 尾注：`q_main_snow`（第三幕）**不在本批**（属 eng-act3）。因此本批的 `act3_done` / `chen_chaoben` 等入场 flag
> 需待第三幕落地后才会点亮——这是两批之间的正常衔接，非缺陷。

---

## 2. 硬约束遵守情况（team-lead 三条）

1. **数组 replace 语义**：✅ 所有目标房间的 `actions` 都写了**全量**——把 `50_map.json` 里既有的 action **原样抄回**再追加/改新。
   被抄回的既有 action（逐字）：`jn_yamen_office·翻名录`、`haitan_boat·搜查`、`taohuadao_dock·回程`、
   `taohuadao_she·破阵`（改 effects）、`palace_road·看封墙`。
   `mojiao_dongfang/nv_huang` 的 `quests` 数组同样写全量。**`palace_prison` 未改动**（见 §6-D1）。
2. **「不报错就是不生效」**：✅ 所有引用的房间 / 物品 / NPC / skill / flag 均已实读核对；
   ⚠️ 两处「设计稿写了、引擎其实不支持」的写法已改写（§6-D3/D4），未硬写。
3. **数据格式**：✅ `66_mainline_act45.json` = 2 空格缩进 + 文件尾换行；
   **`JSON.parse` → `JSON.stringify(...,null,2)+'\n'` 与磁盘字节完全相同**（读回逐字节比对通过，59237 字节，sha256 前 16 位 `3255e7ce85a993f1`）。

---

## 3. 房间 action 清单与计数（13 个目标房间）

| 房间 | 既有 | 新增 | 合计 | 新增 cmd |
|---|---|---|---|---|
| `mojiao_shanmen` | 0 | 1 | 1 | 闯山门 |
| `mojiao_hall` | 0 | 2 | 2 | 过前殿 / 回大殿 |
| `mojiao_shuangxiu` | 0 | 4 | 4 | 上绣楼 / 见教主 / 翻绣架 / 下崖 |
| `jn_brothel_hall` | 0 | 1 | 1 | 劝她 |
| `palace_street` | 0 | 1 | 1 | 拆公文 |
| `jn_yamen_office` | 1（翻名录） | 1 | 2 | 补个名分 |
| `haitan_boat` | 1（搜查） | 1 | 2 | 渡海 |
| `taohuadao_dock` | 1（回程） | 1 | 2 | 入岛 |
| `taohuadao_she` | 1（破阵，**改 effects**） | 0 | 1 | —（破阵重写） |
| `taohuadao_qingyin` | 0 | 1 | 1 | 问三句话 |
| `palace_road` | 1（看封墙） | 2 | 3 | 过御道 / 问夏承志 |
| `palace_hall` | 0 | 3 | 3 | 面圣 / 面圣带抄本 / **收场**（见 §6-D2） |
| **合计** | — | — | — | **19 条新/改 action** |

> 每个新增 action 均含 `cmd`+`label`+`keywords`+`cond`+`failMsg`+`effects`（自验断言）。
> 文案逐字取自 `design/24`；设计稿未给文案处按四幕/五幕语感补（如「下崖」冯保两句台词拆开、
> 「入岛」艄公两句、「收场」旁白）。

---

## 4. 自验结果（**真跑，非读代码**）

自验脚本：`tools/_tmp-act45-verify.js`（`new GameEngine({seed:20261010}).boot()` → `newGame()` → `w.player`，**不用空壳 World**）。

| 检查 | 命令 | 结果 |
|---|---|---|
| 本批专项自验 | `node tools/_tmp-act45-verify.js` | **通过 81 / 失败 0** |
| 地图守卫 | `node tools/map-check.js` | **PASSED 6492 / 0 失败**（未动出口，保持全绿） |
| 房间动作真执行守卫 | `node tools/actions-check.js` | **9 通过 / 0 失败** |
| 主线回归 | `node tools/smoke-mainline.js` | **48 通过 / 0 失败** |
| 任务文本护栏 | `node tools/smoke-quest-sanity.js` | **30 通过 / 0 失败** |
| 任务数据/自动接取 | `node tools/smoke-quest-data.js` | **34 通过 / 0 失败**（新主线**未**在开局被自动接取） |

自验脚本覆盖的断言（节选）：
- `q_main_moye`/`q_main_end` 已加载、段数 6/6、giver 正确、type=主线；
- `mojiao_dongfang.quests` 含 `q_main_moye`；`nv_huang.quests` 含 `q_main_end` **且 `q_taohua_entry` 未丢**；
- `ren_woxing` 存在、`bossPhases` 3 段且 `at` **严格递减**、有 `portrait`、`bossPhases[].skill` 全部真实存在；
- 2 件核心物品存在、`wulin_zhenyi_canjuan.desc` 含「残缺」、`type/noSell/tags/quality` 达标；
- 13 个房间 `actions` 数 = 既有 + 新增（既有没被清空）+ 新增 cmd 均在；
- `palace_token` 三条来路 action 都在、都含 `+item:palace_token`；
- 把**每个** `cond` 与**每组** `effects`（含 `menu` 选项里逐条拆出的字符串 effect）喂 `evalCond`/`evalEffects`，**全部不抛错**。

---

## 5. flag 落点对照（§8.6 第四/五幕）

- **第四幕**：`sentinel1` `sentinel2` `sentinel3`(§4.3 建议保留) `moye_sentinel` `moye_backroad`(读) `buju`(读) `dongfang_talks` `dongfang_pact` `dongfang_hostile` `dongfang_down` `ren_appears` `ren_pact` `ren_refused` `has_canjuan` `know_depot_master` `act4_done` —— **全部有落点或有读取方**。
- **第五幕**：`summoned` `refused_summon` `taohua_road` `taohua_passed` `taohua_brute`(§5.3 文案) `three_words` `shadow_done` `prison_intel` `jujiao_ready` `ending_jiaojuan` `ending_jujiao` `ending_banjiao` `act5_done` —— **全部有落点**。
- 读但**不由本批生产**（依赖 eng-act3 第一/三幕）：`act3_done` `jiuye_stood_aside` `chen_chaoben` `poisoned_xingxiu` `186_warm`/`186_broken` `moye_backroad` `buju` `depot_token_given` `depot_token_half`(物品)。均已按设计读取条件写好，缺则相应分支/加项自然不触发（不报错）。
- `ending_jiaojuan/jujiao/banjiao` 由 `ending` 效果自动置（`p.setFlag('ending_'+args[0])`），故未在 `q_main_end.rewards` 重复写。

---

## 6. 偏离与未做项（**如实列出**）

### D1 · 腰牌来路③ `palace_prison` → `palace_road`（地理修正）
- team-lead 交办单写「`palace_prison`「问夏承志」」；但 `design/21` **§5.3 / §5.1c / 附I-C11** 明确写：
  「原文写的 `palace_prison` 作废——**那是循环依赖**」，必须挂在 **`palace_road`（御道·门外，无需腰牌）**。
  （`palace_prison` 在 `palace_hall.nw` 的 cond 边后，需先有腰牌才能进——用它给腰牌是死锁。）
- **处理**：按设计稿落在 **`palace_road`**，action `cmd:'问夏承志'`（label「御道边那个人」），给 `+item palace_token` + `flag prison_intel`。
- **后果**：`palace_prison` **未改动**（其原有「看封墙」action 原样保留，actions 数仍为 1）。

### D2 · 拒交结局：追加一条续场 action「收场」（引擎能力缺口）
- `design/21` §6 要求「「不交」→ 先进 Boss 战（`depot_master`）→ **打赢后**才 `ending jujiao`」。
- 但引擎 `evalEffects` 是**同步**的：`combat` effect 只调 `w.startCombat` 就返回，
  **没有 onWin 钩子，也没有 `fireEvent('combatend')`**（`world.js:2307` 只有 `emit`）→ **「战斗后落 effect」根本做不到**。
- **等价已支持写法**：`面圣`/`面圣（带抄本）` 的「不交」选项 → `flag:jujiao_ready` + `combat:depot_master`；
  另加一条 `palace_hall` action **「收场」**：`cond = {jujiao_ready & killed_depot_master & !act5_done}` →
  播 §6.2 拒交尾声（含 `{若 prison_intel}` 追加段，用对象 `{if}` 实现）→ `ending:jujiao:拒交` + `flag act5_done` + `questdone:q_main_end`。
- **代价**：`palace_hall` 是 **3 个** action（非交办单的 2 个）。这是本批唯一「多出来」的 action。

### D3 · boss「打赢才置 `_down` flag」——用 `killed_<boss>` 门控的「可重点击」写法
- 同 D2 原因：action 内**无法**在战斗结束后置 flag。若乐观置位，玩家「故意打输」也能推进剧情。
- **等价已支持写法**：引擎在 `onNpcDown`/`onNpcKilled` 自动置 `killed_<defId>`（`world.js:973`）。
  `见教主`/`回大殿`/`过御道` 用 `{if:{flag:'killed_<boss>'}, then:[收束旁白+置 _down], else:[演出/+menu+combat]}`
  的**可重复点击**结构——打赢后再点一次同一按钮即收束。
  - `mojiao_dongfang` → `killed_mojiao_dongfang` → `dongfang_down`
  - `ren_woxing`（仅「不接」分支）→ `killed_ren_woxing` → `ren_appears`
  - `depot_shadow` → `killed_depot_shadow` → `shadow_done`
- **哨卡小怪例外**：`mob_mo_disciple`（闯山门 / 过前殿）因 §4.3 明说「打输**不惩罚**」，
  `sentinel1/2/3`、`moye_sentinel` **乐观置位**（简单、符合「无惩罚」口径）。

### D4 · `menu` 选项只能挂「字符串 effect」——2 项条件/增益未落地
引擎 `menu` effect 由**字符串**生成（`modapi.js:556`），选项的 effect 再按 `;` 拆、逐条字符串解析。
因此**选项内不能写 `{if:...}`、不能传对象 buff**（`+buff` 只认对象参数）。后果：
- `design/24` §6.2「**半交**：若 `ren_pact` → 追加一句『那个欠了人情的人，会在某一天来收账。』」——**未落地**
  （半交是纯 menu 选项，无法内嵌条件）。**已记为未做项**。
- 4-2「战前 `+buff`（他的留手）」：**未给数值**，仅保留旁白演出；
  5-5「先机 `+buff`」用可行写法 `+hp:400` 近似（选项字符串里可写）。**记为近似**。
- 4-2 的 `dongfang_pact`/`dongfang_hostile` 减负：`dongfang_hostile` 语义（打满三阶段）会自然成立，
  `dongfang_pact` 的「减负」**未做数值化**（同因）。

### D5 · `q_main_end.rewards` 不含「三结局 flag 三选一」
- `q_main_end` 的奖励在**三选一之后**由 `questdone:q_main_end` 触发。三个 `ending_*` flag 由各 `ending` 效果
  按玩家选择**单独**落（`ending` 效果自带 `setFlag('ending_'+id)`）。若在 rewards 里再写三个 flag 会**全置位**（错）。
- 故 rewards 只放共用项：`act5_done` + `+exp30000` + `+pot15000` + `+title 名动天下` + 落点旁白。
  三结局 flag 的落点在选项里，自验已核对「三选一 menu 都在」。

### D6 · 其他小偏离（不影响验收）
- `过前殿` 怪物数：设计写 `mob_mo_disciple ×2`，但 `startCombat` 一次只接一个对手（会覆盖 `this.battle`），故只写 1 个。
- `taohuadao_she.破阵`：「硬闯」分支里 `combat:mob_snake` 与后续旁白在**同一帧**执行（字符串 effect 顺序），
  旁白不会等战斗结束——与 D2 同源。已保留战斗与旁白。
- `ending` 的 menu 字符串写法：设计稿 §6 原文 `ending jiaojuan 交了卷`（无冒号）会被引擎当成**未知 effect 类型**
  **静默失效**（正是 team-lead 警告的「写错不报错」）。已改写为正确形式 `ending:jiaojuan:交了卷`。
- `q_main_moye/q_main_end` 的入场条件：设计写「入场 cond `act3_done`/`act4_done`」，引擎的**接取门**是 `qd.require`
  （`commands.js:2852`），stage 的 `cond` 是**交任务门**。故写进 `require`，6 段 `cond` 用各场落点 flag。

---

## 7. 未做 / 待后续

| 项 | 原因 |
|---|---|
| `nv_huang` 可选切磋彩蛋（E11） | 设计明定**默认不做**（他是委托人） |
| `luoying_shenjian_zhang` skill | 同上，不需要 |
| 三幕 `q_main_snow` / 三幕 5 件物品 / 三幕 13 action（E9/E10） | 属 eng-act3 批次 |
| D2/D3 若想要「一次点击即收束」的完美体验 | 需**改引擎**加「战斗后 effect」钩子——本批按边界**未动** `game/src/**`，如需请另开任务 |
| §4.3 sentinel 的「逐道重来」精细度 | 已用乐观置位 + 「打输不惩罚」口径（§4.3 原文即如此） |

---

## 8. 改动文件清单

| 文件 | 动作 |
|---|---|
| `game/data/66_mainline_act45.json` | **新建**（唯一产品数据文件） |
| `tools/_tmp-act45-verify.js` | 新建（自验脚本） |
| `tools/_tmp-gen-act45.js` | 新建（数据生成脚本，留档可复现） |
| `design/38-act45-report.md` | 新建（本报告） |

**未改动**：`game/data/40_npcs.json`、`50_map.json`、`60_quests.json`、`game/src/**`、任何 mod。
**未 commit**（留工作区）
