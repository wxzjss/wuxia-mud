# 113 · 门派山门「拜入门下」补 joinSect（阻断级，游有方 2026-10-18）

> 来源：qa-lead 门派链审计（台账 `tools/_out_sect_chain.tsv`，基线 HEAD `2a019b1`）。
> 落法：`tools/_apply_sect_gate_joinsect.py`（幂等，走 `_canon_write`）+ `tools/_sect_gate_check.js`（真走 32/0）。

## 一、症状
`73_sects_place.json` 的 29 个 `*_gate`，动作是
`{label:'拜入门下', cmd:'拜师 <门派>', effects:[{narrate:'山门里走出一个人…'}]}` —— **没有 joinSect**。
玩家在山门口点唯一看得见的按钮/敲同一句，只会读到那句描写，`p.sect` 仍是 null；走开一步再敲命令反而能入门。
**最该拜师的地方拜不了师**，29/43 派全中（泰山/衡山/恒山/青城/崆峒/昆仑/点苍/铁掌/合欢 + 19 个三流派）。

## 二、修法（qa 方案 1）
effects 末尾补 `{"type":"joinSect","args":["<sectId>"]}`，**原 narrate 保留、只补不删**。
`joinSect` 与命令走同一函数（`character.joinSect`）→ 性别/属性/karma/引荐信/叛门冷却等门槛**自动继承**，不另写判据。
sectId 由房名推导：`<sectId>_gate` 去掉后缀，并核过 43 派表里都有对应条目（`cunzhen_gate` / `jn_brothel_gate` 不是门派，跳过）。

## 三、验收（真走 32/0）
- **29 个山门逐个**：造达标玩家（六属性 30 / 50 级 / karma 按门槛调 / 性别按门槛）→ 同房 `exec('拜师 X')` → `p.sect === sectId`，29/29 通过。
- **qa 复现点**：`jindao_gate` 直接拜师 → `p.sect='jindao'`，且回执里有「拜入…门徒」，不再只剩空壳 narrate。
- **门槛不达标**：桃花岛（悟性 18）被拒 —— 但**拒绝文案是坏的**（见 §四）。
- 门禁：`data-write-guard 53/53` · 朱雀 0·>10 · load 76/0 · map 6484/0 · npc-skills 47/0 · sidequest 57/0 · `_label_fix_check 23/0` · apply 两连跑幂等（第二遍「补 0 处 / 跳过 29」）。

## 四、发现一个引擎侧文案 bug（归寇豆码 lane，已单独发他）
`character.sectRefusal` 处理 `require` 时只认 `gender / karma / wis|悟性 / skill / 数字键`，
**不认数据里实际在用的 `{attr:'悟性', '>=':14}` 这种「属性 + 运算符键」写法**：
- 结果 1：拒绝文案变成 `桃花岛不收你：>= 需 18（你 0）。`（键名当成属性名、运算符当条件）；
- 结果 2：比较也走错分支（`this['>=']`），只是 `joinSect` 真判用 `evalCond` 才对——**文案与判定两套逻辑**。
修法建议：先按 `evalCond` 判一次，再按 `attr / rep / level / race / item` 逐类生成「卡在哪一条」的文案；运算符键并入对应类别。

## 五、同族三项（非阻断，未在本批动）
1. **入门房「可做」为空**：29 个 gate 修完后都有「拜入门下」；`cunzhen_gate / jn_brothel_gate` 不是门派山门，保持现状。
2. **门派任务只覆盖 8 派（13 条）**，其余 35 派入门后无门派事可做 —— 建议批 8 做「门派差事」模板：每派 2–3 条（护山/巡山/采办/传话），共用一套结构，**同时解决第 3 项**。
3. **无「差事→贡献」通道**（贡献只有捐钱与门派大比）—— 建议随门派差事给 `contrib`，并加一条每日「巡山」房动作（低额贡献、可重复、有冷却）。

## 六、留账
- 29 个 gate 的入门文案仍统一是「山门里走出一个人，上下打量了你两眼。」——**29 派同一句**，是明显的模板感；
  本批只修功能不铺文案（阻断优先）。建议下一批按门派气质各写一句（剑派看手、刀派看肩、帮派看鞋、佛道看礼数）。

## 七、回归修复（同日）：label 批带出的两处红

**红① `smoke-portrait` 元怀瑾口头禅抽不出**
- 真根因（寇豆码查实）：引擎规则 `selfSuffRoomAction` —— **房动作自带 effects 时优先于内置指令**。
  我在 label 批为治「点也死」给 `talk 元怀瑾 / talk 县太爷` 补了 effects，结果把内置 NPC 对话（画像口头禅 30%、信任轴、问答）整条盖住。
- 正确修法：**删掉这些空壳 `talk <真名>` 房动作**，让内置 talk 接管（NPC 就在房里，本来能说话）。
  一并删的：`jn_yamen_court talk 元怀瑾 / talk 县太爷`、`jn_pharmacy talk 陈济仁`、`jn_brothel_gate talk 苗春`、`50_map jn_yamen_court talk 县太爷`（被 62 覆盖的旧颗）。
- 实测：`talk 元怀瑾` → 「元怀瑾淡淡道：「本官事忙，……」」+ 熟络度提示（内置对话回来了）；`smoke-portrait-batch` **连跑 3 次 376/0**。

**红② `say-hint-check` 68/69 + 账本孤儿**
- 根因：我删了 jn_bookshop 的空动作 `list 林守拙`（空 list 会挡内置货摊，必须删），而 `_out_say.tsv` 还挂着它的 say；删空壳 talk 后又多出 3 条孤儿（县太爷/老鸨/老郎中）。
- 处置：从 `_out_say.tsv` 删掉这 4 行（**施工图与数据对齐，不是改判据**）；现 `显式 say 落库 65/65`，`say-hint-check 15/0`。

**纪律新增（建议入 84）**
1. **`talk/ask <真名>` 一律不挂房动作**：NPC 在场时内置对话就是活的；房动作只用于「NPC 不在场」的代答，且**一旦带 effects 就会永久盖住内置对话**（画像/信任/口头禅全跳过）。
2. 施工图台账（`_out_say*.tsv`）里每一行都必须能指向一个**现存 action**；删动作时同一刀删台账行，别让账本悬空。
