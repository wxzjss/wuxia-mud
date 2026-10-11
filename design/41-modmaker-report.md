# 41 · Mod 制作器（modmaker.js）体检报告

> 体检对象：`game/src/renderer/js/modmaker.js`（真相源） + `server/public/js/modmaker.js`（逐字节副本）
> 出发点（主人原话）：**「方便小白也会做 mod」**。一切结论回到这一条。
> 自验：`tools/_tmp-modmaker-verify.js` → **21 通过 / 0 失败**；回归 `tools/smoke-round3.js` → **37 通过 / 0 失败**。
> 未碰任何其它文件；两份 modmaker.js `cmp` 一致。

---

## 0. 一句话结论

制作器的**骨架是对的**（字段口径早已对齐武学重制：中文十槽位、五大类、检查报告一次列全）。
但存在 **1 个会「永久拦下小白上传」的严重 bug**、**1 处「教程说中文、下拉给英文」的落差**，
以及若干武学新口径字段（品级 / 内功被动加成）**填不了**。已全部修复并加回归断言。

---

## 1. 字段覆盖（武学重制后的新口径认不认？）

| 口径 | 制作器现状 | 结论 / 证据 |
|---|---|---|
| **五大类** `外功/内功/奇门/旁门/魔功` | `tabSkills` 读 `meta.skillCategories`，兜底亦中文 | ✅ 下拉实测五项（自验 **A-3**）。⚠️ 任务描述里的「**奇功**」是笔误——代码/数据/`design/06` 都是「**奇门**」，以引擎 `editorMeta` 为准 |
| **中文槽位名** `拳/剑/刀/棍/鞭/暗器/内功/轻功/招架/身法` | 下拉十项（自验 **A-2**）；兜底也是中文（旧版兜底是英文 sword/force/dodge） | ✅ 且**新增**：异常槽位（如导入的 `sword`）在表单里**当场给大白话**（自验 **A-5**），报告页给中文「已纠正为剑」（**A-12/A-13**） |
| `category` | 表单有「分类」下拉（五大类） | ✅ A-3 |
| `quality`（品级） | ❌ **原来没有**（表单填不了；引擎会补 `common`） | **已补**：武学「品级」六档中文（粗劣/寻常/精良/珍稀/绝世/传说），对齐 `core/social.js` 的 `QUALITY_TIERS`（**A-4**）。物品也补了「品级（不填按价格推断）」（**A-7**） |
| `maxLevel / damageMult / accuracy / mpCost / difficulty` | 表单已有 | ✅ 见 `tabSkills` |
| 武学 **`bonus`**（内功被动加成 `maxHp/maxMp/atk/def/critRate`） | ❌ **原来没有** | **已补**「被动加成」5 项——这是「内功 Mod」的核心（`character.js:219-232` 按 `bonus` 结算） |
| 物品 `slot`（中文部位） | 下拉中文（头部/身体/脚部…） | ✅ A-8 |
| 新地块类型（家园 8 类，含地牢） | ❌ 制作器**无**地块编辑入口 | 未覆盖，见 §4（原因：属新增整块能力，且不在可改文件内） |
| 新指令 / `25_craft.json` 新配方 | ❌ 制作器**无**配方/指令编辑入口 | 未覆盖，见 §4。另：`meta.itemTypes` **缺 `tool`**（`25_craft.json` 用 `type:"tool"`）——meta 由引擎产出，不在可改文件内，仅点名 |

引擎侧校验（`engine.validateSpec`）本身已很到位：英文槽位／非法槽位、缺分类、`maxLevel` 过小都会提示（回归 **M-4 / M-4b** 绿）。

---

## 2. 小白友好度

### 2.1 🔴 最严重：一个「幽灵错误」会把小白永久挡在上传门外（已修）

**现象**：`blankSpec()` 里带了 `meta: {}`。引擎 `normalizeSpec` 判定 `const metaSrc = spec.meta || spec`——
一个空的 `meta` 对象是 **truthy**，于是把顶层的 `id/name` **整个遮掉**，
校验**恒**报「Mod ID 必须填写 / 请填写 Mod 名称」。

**证据**（直接喂真引擎）：
```
无 meta      → errors: []                                    meta.id = x1
带 meta:{}   → errors: ["Mod ID 必须填写…","请填写 Mod 名称"]  meta.id = (空)
```
**后果链**：`doUpload` 先判 `S.spec.id/name`（有值→过），再 `runValidate` → 报 2 个错误 → **上传被拦**，
且提示语指向「Mod ID 没填」，可小白**明明填了** —— 完全无从下手。`doSave` 也会弹「还有 2 个错误」。

**修复**：删除 `blankSpec()` 的 `meta: {}`（前端从不读 `S.spec.meta`，`specToJson` 也不产出 meta，删除零副作用）。
**守卫**：自验新增 **A-14**（填好的表单 errors 里不得再出现这两句）。

### 2.2 「教程说中文、下拉给英文」的落差（已修）

`docdata.js` 的小白教程第 4 步写着：「**类型**：丹药选「消耗品」，兵器选「武器」，秘籍选「书籍」」——
但物品**类型下拉**原本直接用了英文码，选项是 `weapon / consumable / book …`，**照教程根本找不到**。

**修复**：物品类型改用引擎给的 `meta.itemTypeCN`（weapon=武器、consumable=丹药、book=书籍…）做标签，
值仍是英文码（引擎要的），**小白只看中文**（自验 **A-6**：`<option value="weapon">武器</option>`）。

### 2.3 部位同理（已加防）

从别处抄来的 mod 可能写英文 `slot`（`weapon`/`body`），游戏按**字面**当槽位键 ——
实测 `demo_item` 的 `wugou_jian` 会占出一个**英文槽 `weapon`**（与中文 `武器` 并存）：
```
equip -> {"ok":true,"slot":"weapon"}  equipment keys=[… ,"武器", …, "weapon"]
```
制作器**新增**：非法部位在表单里当场点名（自验 **A-15**）。

### 2.4 其余（本来就 OK，无需改）

- **导出前自检**：✔ 已有。右上「检 查」→「检查报告」页，**一次列全** errors / warnings / infos，不是修一个报一个（自验 **A-13**）。
- **必填提示**：名称/ID 带 `*`；「类型」有常驻 tip（选中文槽位名）。
- **报错文案**：引擎侧的提示已是**大白话**（甚至写明「写英文（sword/force/dodge）这门武学会装不上任何槽位」）。
- **默认值**：新建武学默认 `拳 / 外功 / 寻常`；新建物品默认 `consumable`（现显示「丹药」）。

---

## 3. 导出的 mod 能不能真被加载（真加载，不只看代码）

自验 **B 段**：把前端 `specToJson()` 的输出落成 `mod.json`，放进**独立临时 `modsDir`**（系统临时目录，不碰项目 `mods/`），
再 `new GameEngine({modsDir}).boot()`：

| 断言 | 结果 |
|---|---|
| B-1 武学 `k1` 进了 `world.data` | ✔ `{"type":"剑","category":"外功","quality":"rare"}` |
| B-2 加载后 type=剑 / category=外功 / quality=rare | ✔ |
| B-3 写成英文 `sword` 的 `k2` 经归一化变成「剑」 | ✔ |
| B-4 物品 `i1` 进了 `world.data`，`slot=武器 quality=fine` | ✔ |
| B-5 ★ `enable 测试剑` **真装进「剑」槽** | ✔ `剑=k1`（英文槽位时这一步只会得到「没有「sword」这个槽位」） |

→ 制作器导出的 mod **确实能加载、内容真进了世界**。

---

## 4. 官方示例 mod 是否同步

- `mods/demo_skill`：**已同步**（type 中文、category 五大类、NPC 挂武学到槽位）——回归 **M-1/M-1b/M-1c/M-2** 全绿。
- **发现的口径不一致（均不在我可改文件内，仅报告）**：
  1. `mods/demo_item/mod.json`：`slot:"weapon"/"body"/"feet"` 是**英文**。实测会占出英文槽（见 §2.3）。**建议改中文**（`武器/身体/脚部`）。
  2. `mods/demo_skill` 的 `taixu_xinfa.bonus = { "hp":6, "mp":10 }` 用的是 `hp/mp`，但 `character.js:226-227` 只认 `maxHp/maxMp` → 这条内功加成**静默失效**。**建议改 `maxHp/maxMp`**。
  3. `game/src/renderer/js/docdata.js` 的「功法 Mod 示例」JSON（L426 `type:'sword'`、L443 `type:'force'`）仍是**旧英文口径**——它正是「小白教程 / 示例」里给人抄的内容，**建议同步**；`server/public/js/examples.js`（站点示例）需一并核。

---

## 5. 改了什么（每条对着「小白会不会卡住」）

| # | 改动（`modmaker.js`） | 为什么（小白视角） |
|---|---|---|
| 1 | `blankSpec()` 去掉 `meta: {}` | 不修则**上传被永久拦下**，且报「Mod ID 没填」而小白已填（§2.1） |
| 2 | 新增 `QUALITY` 常量（六档中文） | 小白看不懂 `rare/epic`，且**品级原来无处可填** |
| 3 | `tabSkills`：加「品级」下拉 + 「被动加成」5 项 + 非法槽位即时提示 | 内功 Mod 的加成填不了；英文槽位导入后当场就能看见问题 |
| 4 | `tabItems`：类型标签改用 `itemTypeCN`；加「品级」下拉；非法部位即时提示 | **教程教中文、下拉给英文**的落差；抄来的英文部位会静默占错槽 |
| 5 | `newRowDefaults('skills')` 默认 `quality:'common'` | 新行开箱即合理 |
| 6 | `accuracy` 占位改「留 0 用默认」 | 引擎把 0 当默认值（90），给个提示 |

全部为**纯前端表单/默认值/提示**改动，不动引擎、不动数据、不动校验口径（校验真相源仍是 `engine.validateSpec` + `core/modfields.js`）。

---

## 6. 没做的 & 原因

1. **家园地块(8 类/含地牢) · 新配方(`25_craft.json`) · 新指令 的编辑入口** —— 未做。
   属**新增整块 tab**，且需要引擎侧 `normalizeSpec/buildModFiles` 支持 `recipes/plots` 的 spec 归一化（不在可改的 2 个文件内）；
   对「小白做第一个 mod」的常见诉求（剧情/地图/功法/物品/人物）优先级低。**列为缺口**，建议单独立项。
2. **`meta.itemTypes` 缺 `tool`** —— 未在前端私补。meta 是引擎产出（`engine.editorMeta`），
   前端自补会与「单一事实源」分叉，按本项目铁律（字段口径靠归一化入口）不宜。仅报告。
3. **版本戳未顺推** —— 改了前端脚本，按惯例 `index.html` 的 `?v=` 应顺推（当前 `20261010t`）；
   但 `index.html` 及其副本**不在允许改的文件内**，需团队统筹。
4. **`docdata.js` / `mods/demo_*.json` / `examples.js` 的旧口径** —— 不在允许改的文件内，仅报告（§4）。

---

## 7. 自验与回归结果

| 脚本 | 结果 |
|---|---|
| `tools/_tmp-modmaker-verify.js`（新建） | **21 通过 / 0 失败** |
| `tools/smoke-round3.js`（§F 昏倒 + §M mod 口径，含 M-1~M-5b） | **37 通过 / 0 失败** |
| `tools/account-check.js` | exit 0（`modmaker 已无云端发布分支` / `保留站点上传` 全绿） |
| `tools/game-ui-check.js` | exit 0（版本戳一致 / modmaker 走站点 / 副本一致 全绿） |
| 两份副本 `cmp` | **逐字节一致** |

**自验脚本覆盖的硬断言**：中文十槽位下拉（A-2）、五大类下拉（A-3）、品级下拉（A-4/A-7）、
英文槽位表单提示（A-5）、英文部位表单提示（A-15）、物品类型中文标签（A-6）、
导出预览含 `category`/`quality`（A-9/A-10）、幽灵错误消失（A-14）、
报告页中文「已纠正为剑」（A-12/A-13）、导出 mod 真加载 + 真 `enable`（B-1~B-5）。
