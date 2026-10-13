# Mod 制作器体检报告

（2026-10-12）主人要求「看一下 Mod 制作器需不需要更新完善一下」。

**结论：需要，而且缺口不小。** 不是坏了，是**跟不上**——引擎这一年加的东西，制作器有一半没入口。

体检方式：把 `mods/` 下 7 个官方示例 mod 的字段全抓出来，跟制作器表单里能填的字段逐个比对；
再把引擎侧真实消费的字段/枚举抓出来，跟制作器下拉里的选项比对。**不靠印象，靠对表。**

---

## 一、验证过的、没问题的（先说好消息）

| 项 | 结论 |
|---|---|
| `onEnter` 教玩家写 `say:你踏入门内…` | **能用**。端到端实测：字符串写法与数组写法**都触发**（`world.js:2491` 的 `evalEffects` 认字符串，见 `modapi.js:379 parseEffectString`） |
| `maxLevel`（熟练度上限） | **仍有效**，不是废弃字段。它是熟练度分母（`profTierIndex(level, maxLevel)`），数据里 300 是标准值 |
| NPC `level` | **仍有效**（数据里 1376 处，`engine.js:416/998/1470` 都在读）。核了，别删 |
| `exits` / `stages` / `nodes` / `rewards` / `color` / `onEnter` / `onLook` | 都有子编辑器，不是缺口（我第一版正则没匹配上，实际有） |

---

## 二、真正缺的（按数据规模排序）

| 字段 | 数据规模 | 属谁 | 不填的后果 |
|---|---|---|---|
| **`learned`** | **470 处** | NPC | NPC 会的功法编不了 → 照抄示例 mod 抄不出「岳不群会紫霞神功」。**这一条正对着主人钦定的 B8（按身份/门派/层级分配功法）** |
| **`actions`** | **301 处** | 房间 | 房间交互动作（打水/打铁/住店/采药/搜查）编不了 → 武侠 MUD 最有味道的一类内容做不出来 |
| **`ask`** | **141 处** | NPC | 打探消息（专属话题+关键词+回答）编不了 → 只能编通用「闲聊」 |
| `askDefault` | 16 处 | NPC | 「江湖消息」的兜底回答编不了 |
| `encounter` | 1 处 | 房间 | 随机遭遇编不了（字段有，制作器没入口） |
| **效果类型缺 6 种** | — | 武学 | 引擎支持 15 种（`combat.js` 实查），制作器只列 9 种，**缺 `aoe`/`confuse`/`silence`/`mp`/`custom`/`cond`** |

---

## 三、文案错误（比缺字段更坑）

| 位置 | 现在写的 | 实际语义 |
|---|---|---|
| 武学「最高等级」 | `maxLevel` | 是**熟练度上限**（六级熟练度：未入门→登峰造极），不是等级 |
| 武学被动加成 | 「学会后**随等级**生效」「每 10 级 +N」 | 实际是 `sqrt(lv/300)` 缩放（`character.js:354`）：**300 熟练度拿满 1 份**，不是线性 |
| 武学分类提示 | 没说清 | 五大类（外功/内功/魔功/奇门/旁门）与「类型（槽位）」是两回事，容易填错 |

「每 10 级 +N」这条最坑：作者照这个脑补数值，实际填进去的量级会**差一个数量级**。

---

## 四、改进方案（按性价比排序）

### P0（本次就做）
1. **NPC 加 `learned`（会的功法）** —— 对位 B8，且示例 mod 里到处是它。
   形态：`{skillId: {level: 400}}`，比照「可请教武学」那行的逗号分隔法，做「功法ID:熟练度」列表。
2. **NPC 加 `ask`（打探消息）** —— 行式编辑器：`话题 | 关键词(逗号) | 回答`。
3. **房间加 `actions`（交互动作）** —— 行式编辑器：`按钮名 | 指令 | 关键词 | 效果(用 onEnter 那套写法)`。
4. **武学效果类型补全 6 种**（aoe/confuse/silence/mp/custom/cond）。
5. **武学被动加成补 4 项**（dodge/parry/speed/lifesteal，`character.js:363-367` 早就在消费）。
6. **文案纠错**：「最高等级」→「熟练度上限」；「每 10 级 +N」→「300 熟练度拿满 1 份」；
   分类提示说清「五大类 vs 槽位」。

### P1（下一批）
7. 房间 `encounter`（随机遭遇）。
8. NPC `askDefault`。

### 不做
- 不动 `maxLevel` / NPC `level` 字段名（引擎还认，改了是破坏）。

---

## 五、守卫

改进后给制作器补一条**对表守卫**（`smoke-modmaker-fields.js`）：
把「引擎真实消费的字段/枚举」当唯一真相，断制作器**不能漏**（漏了立即红，防止以后再漂移）。
这是这次体检最该沉淀下来的东西——**对表比印象可靠**。

---

## 六、落地记录（2026-10-13 版本戳 20261013c）

### 已改（全部在 `game/src/renderer/js/modmaker.js`）

| 项 | 做法 |
|---|---|
| NPC `learned` | 新增 6 个「多行文本 ⇄ 真结构」转换函数之一 `learnedToLines`/`linesToLearned`；一行一门 `功法ID:熟练度`，**认全角冒号**，只写 id 时按 300 兜底 |
| NPC `ask` | `askToLines`/`linesToAsk`；一行一条 `话题 \| 关键词(逗号) \| 回答`；**兼容映射对象写法** `{"话题":"答案"}`；回答里带 `\|` 不截断 |
| NPC `askDefault` | 普通单行输入 |
| 房间 `actions` | `actionsToLines`/`linesToActions`；一行一个 `按钮名 \| 指令 \| 关键词(逗号) \| 效果`；效果按 `;` 拆成字符串数组（交给引擎 `parseEffectString` 拆） |
| 武学效果类型 | 9 → **15** 种（补 `aoe`/`confuse`/`silence`/`mp`/`custom`/`cond`） |
| 武学被动加成 | 补 `dodge`/`parry`/`speed`/`lifesteal`（引擎 `character.js:363-367` 早就在消费） |
| 文案纠错 | 「最高等级」→「熟练度上限」；「每 10 级 +N」→「300 熟练度拿满 1 份」；分类提示说清五大类 vs 槽位 |

三处转换都接进 `data-bind` 的 handler（`/\.learned$/`、`/\.ask$/`、`/\.actions$/` 三个分支），
**填了才真写回结构**——不然只是一堆好看的空壳。

### 守卫 `tools/smoke-modmaker-fields.js`：40 通过 / 0 失败

七段对表：① 高价值字段必须有入口（含 `exits`/`effects` 的**结构写回型**入口，单独判形态）
② 效果类型不漏 ③ bonus 键不漏 ④ 文案不说谎（**先抠掉 JS 注释再断** —— 否则被自己的纠错注释噎死）
⑤ 6 个转换函数真往返 ⑥ 转换真接进 data-bind ⑦ 引擎导出白名单也带上（双向对表）。

### 踩坑留档

- **守卫④的假红**：`modmaker.js` 里「每 10 级 +N」唯一残留是**纠错注释**（记录旧错误文案），
  不是给作者看的正文。守卫断正文前必须 `replace(/\/\*[\s\S]*?\*\//g, ' ')` 抠注释 ——
  **守卫要断「活文案」，不能把纠错记录也扫进去**。
- **守卫①的假红**：`exits`/`effects` 不走 `xx.N.field` 形态（走 `S.spec.rooms[i].exits[dir]=v`
  与 `S.spec.skills[i].effects.push(...)`），硬套 `xx.N.field` 会假红。对表要**认多种入口形态**。
- **`_test-save-dir.js` 不能删**：它是 20+ 个测试共享的工具，清理临时文件时手滑删过，
  得 `git checkout` 恢复。`tools/_*` 前缀不代表都能删，**删前先 grep 谁在 require**。

## 七、附录：modloader 损坏 mod 报错路径实测（2026-10-13 · 寇豆码，只测不修）

主理人问：mod 目录里混进一个 mod.json 是坏 JSON 的 mod，现在是什么行为——静默吞、报错、还是跳过？
本节是实测记录（脚本 `.livetest/dbg-modloader-broken.js`，10 通过 / 0 失败；**只测，没改任何产品代码**）。

### 实测结论

**不是静默吞，也不是 crash——是「标记 + 过滤 + 三条可见路径」，坏 mod 不进世界但玩家看得到：**

1. **加载器层**（`game/src/core/modloader.js:124`）：`readModDir()` 解析 `mod.json` 失败时 catch，
   返回 `{ id, name: '目录名（解析失败）', dir, broken: true, error: 具体报错, enabled: false }`。
   **error 里带原始 JSON 解析报错**（实测：`Expected double-quoted property name in JSON at position 36…`）。
2. **生效层**（modloader.js:250 / 273）：启用集与加载顺序都按 `m.enabled && !m.broken` 过滤，
   坏 mod **一条内容都不会进世界**，游戏照常运行——不会拖垮 boot。
3. **玩家可见路径一（MOD 管理界面）**：坏 mod 仍在 `scan()` 返回列表里（`mods` 原样发给前端），
   玩家在 MOD 管理里能看到一个名字叫「`xxx（解析失败）`」的条目。⚠️ 附注：broken mod `enabled:false`，
   列表里它显示为未启用状态——玩家看得到它存在，但**点不出它为什么坏**（error 字段前端是否展示未核）。
4. **玩家可见路径二（boot 日志）**（`game/src/core/world.js:353` `reportBrokenMods()`）：
   boot / reload 时对每个 mod 目录重扫一遍，把 broken mod 报成
   `【Mod 加载失败 · 来自 mods/xxx/mod.json】元数据解析失败：<原因>…这个 Mod 已跳过…`
   走 `modLog.push({level:'error'})` + `console.error('[dataload] …')`。
   注释里明说这是「第三种不报错就是不生效」的补报（前两种在加载层）。

### 实测断言清单（dbg-modloader-broken.js）

| # | 断言 | 结果 |
|---|---|---|
| 1 | broken mod 出现在 `scan()` 返回里 | ✓ |
| 2 | `broken === true` / `enabled === false` | ✓ |
| 3 | `name` 含「（解析失败）」 | ✓ |
| 4 | `error` 有具体 JSON 报错文案 | ✓ |
| 5 | 好 mod 同目录不受牵连 | ✓ |
| 6 | 启用集过滤（`enabled && !broken`）把坏 mod 排除 | ✓ |
| 7 | `require('./modloader').ModLoader` 是构造函数（reportBrokenMods 的取法成立，含 world.js:354 注释里那个「不是构造函数」的坑已防） | ✓ |
| 8 | 重扫仍能找到 broken ⇒ reportBrokenMods 会报出 | ✓ |

### 判定与遗留

- **现状判定：合格，不需要修。** 坏 mod 不进世界、不拖垮 boot、两处可见（列表 + boot 日志）。
- **遗留（不立项，记录在案）**：MOD 管理列表里坏 mod 的 `error` 具体原因前端是否展示未核——
  如果玩家只看到「（解析失败）」四个字而不知道去翻 boot 日志，体验上还差半口气。
  属于前端展示项，与「报错路径本身」无关，故只测不修。
