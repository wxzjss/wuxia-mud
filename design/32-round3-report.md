# 第三轮三项 · 修复/实现报告

> 记录时间：2026-10-10（v3 版发布后）
> 主人原话：
> 「能不能给NPC的看NPC互动添加一个新的效果？就是玩家点NPC会弹出一个互动界面，
>   在里面点看该NPC的那个按钮会弹出一个新的界面会显示该NPC的比较详细的各方面信息
>   包括人物背景故事，还有个事情就是玩家死亡应该显示玩家昏过去而不是真的死亡，
>   玩家会在最近客栈苏醒，还有更新了这么多看一下mod站以及示例mod和mod制作器
>   是否有问题需要更新一下，搞好后发布」

拆成 **3 项**（台账 B38–B40）。

---

## 总览

| 台账 | 事项 | 关键改动 |
|---|---|---|
| **B38** | NPC 详情界面（含背景故事） | `engine.npcProfileOf()` + `POST /api/npc` + `openNpcProfile()`/`npcProfileHtml()` 新模态框 + `.npc-prof` 样式 |
| **B39** | 「死亡」→「昏倒」，最近客栈醒转 | 两套漂移的复活实现合并为 `survival.respawnAtInn()` 唯一入口；新增 `kind:'faint'` + 前端样式；修掉「报的损失数字 ≠ 实扣」的谎报 |
| **B40** | mod 站 / 示例 mod / 制作器体检 | `core/modfields.js` 字段归一化（挂进三条加载路径必经点）+ 示例 mod 写中文口径 + 制作器下拉/默认值/校验 + 站点示例内容按指纹自动同步 |

**验收**：53 套回归全绿 · 10 条变异全部被抓住（逐字节还原） · 真服务端到端核对通过。

---

## B38 · NPC 详情界面

### 做了什么

点 NPC → 互动菜单第一项 **「细看此人 (profile)」** → 弹出**新界面**，分节显示：

1. 身份 / 性别年龄 / 所在 / 一句话外观 / 画像 `role`（这是个什么人）
2. 修为（境界 + 层数）、气色（伤情）、性子、住处
3. **与你的关系**（好感/信任折算成一句人话）
4. 武学（槽位·功法·熟练档位；交情浅只报「深不可测」）
5. 随身行头（穿戴 + 携带 + 大概有多少钱）
6. 能教你什么（含「好感 ≥N」门槛）
7. 作息（白天在哪 / 夜里在哪）
8. **来历与心事**（画像背景故事：来历 / 近况 / 想头 / 惧怕 / 执念 / 隐秘）
9. 恩怨（谁跟谁有过节）、说话的口气（口头禅/谈吐）、平日做什么（作息细节）

底部三个按钮：**打 量**（老 `look` 文本流）、**交 谈**、**关 闭**。

### 设计取舍 —— 背景故事**分层解锁**（别把它改成全公开）

项目里早有「信任度（trust）到多少才肯说」的规矩（`commands.js` 的询问分支：
来历 0 / 近况 20 / 想头 50 / 惧怕 70 / 恩怨 40 / 隐秘 50+tier×5）。
详情面板**沿用同一套门槛**，并且：

- 未解锁的条目**不隐藏**，而是原样列出、只给一句「他还信不过你 —— 替他办成几件事再说」。
  藏起来玩家就不知道「这里还有东西」；全给出来则把 128 个人的底细摊在桌面，
  「人情往来」整条线就废了。
- 已解锁的**集中呈现**，省得玩家一个个话题去问 —— 这才是这个面板的价值。
- 已从他嘴里问出过隐秘（`pstate.revealed`）的，面板里留得住，不会读过就没了。
- **不列** `likes`（他喜欢收什么礼）：那是送礼要试出来的东西（`social.js` 的「合口味」判定），
  列在面板上等于官方攻略。
- 不打印 `trust=53` 这种数字：好感/信任一律折算成人话
  （「你与他只是点头之交」/「他信得过你办事」）。
  只有「能教你什么」保留「好感 ≥40」——那个数字玩家**必须**知道，否则不知道该刷到多少。
- `arc`（人物弧光：谁会因什么变暖/变冷/翻脸）**不露**，那是设计文档级信息。

### 旁观：这同时把「画像」接了一遍

画像数据（`portrait`）此前 128 张里只有 `role/now/want/voice` 被用到，
`origin/fear/obsession/secret/feuds/routine` 只能靠询问一点点问出来（且要过 trust）。
本面板把**已解锁的部分**汇集呈现 —— 是「画像接线」这件待办里最自然的一块。

### 断言（`smoke-uiux` §11，真链路）

真 engine → 真 `spawnNpc` → 真场景卡 `onclick` → 真 `choices` 项 `onclick`
→ 真 `api.npcProfile`（喂真 `engine.npcProfileOf`）→ 真 modal → 读真 `#modal-body`。

| 断言 | 变异 | 结果 |
|---|---|---|
| S11-1 真点「细看此人」弹出新界面（正文 >60 字） | 菜单退回「查看 (look)」 | **红** |
| S11-2 ★ trust=0 时**只有「来历」**可见，其余给锁提示、不泄正文 | 门槛判据写死 `true` | **红** |
| S11-3 ★ trust=80 时背景故事全开、锁提示消失 | — | 绿 |
| S11-4 ★ 不列「他喜欢收什么礼」 | 加一行「他偏爱的东西」 | **红** |
| S11-5 底部「交谈」真派发 `talk <名字>` | — | 绿 |
| S11-6 没画像的 NPC 也能开（不白屏） | — | 绿 |

> ⚠️ **S11-2 漏抓过一次，值得记**：第一版断言写的是「locked 非空 + 每个 locked 都带锁提示」。
> 把前五条的门槛写成 `true` 之后，**「隐秘」那条仍然是锁的**（它的门槛判据在另一个分支），
> 于是 `locked=['secret']` 非空、断言照样绿。改成
> 「解锁集合必须**恰好等于**门槛算出来的期望集合」才抓住。
> 教训：**别用「非空/有东西」当断言，要用「等于期望的集合」**。

---

## B39 · 「死亡」→「力竭昏倒」

### 根因（三处，全在「同一个动作两条路」上）

1. **两套复活实现并存且漂移**：
   - `world.playerDeath()` 里扣钱（`money -= 20%`）+ 折功力（`exp *= 0.9`）+ 计数；
   - `engine.postProcess` 里**另一段内联**复活代码（搬客栈、回血、写台词），
     **只算了 `lost` 拿去写台词、压根没扣钱** —— 玩家看到的「你损失了 N 文钱」是假的；
     而且它按**扣后**余额算 20%，即使真扣过，报的数也对不上。
   - **`survival.respawnAtInn()` 是死代码**（除了定义与导出全仓无人调用），
     且它的文案与内联那份**不一样**（「少了些银钱」/「好心的过路人」）。
2. **战斗里被打倒从不计「昏倒数」**：`combat.js` 的 `onDeath` 玩家分支自己
   `t.dead = true` 就返回了，**绕过 `world.playerDeath()`**；只有饿昏/渴昏那条路会计数。
3. **玩家可见文案**：被打倒那行是 `kind:'combat'`「你眼前一黑，倒了下去……」，
   前端没有专属样式，与普通战斗行混在一起，观感就是「被打死了」。

### 改法

- **合并成唯一入口** `survival.respawnAtInn(world, lines, opts)`：
  落点（青楼卖身者由 engine 传 `anchor`）→ 结算（掉两成银钱 + 折一成功力，**只在这里扣**）
  → 搬人 → 回血回气回饥渴 + 清 buff → 写「昏倒 / 醒转」台词（原地昏倒就别说「被背回来」）。
  `world.playerDeath()` 只剩「置标记 + 计数」。
- **新增 `kind:'faint'`**（昏倒/醒转专属语义）+ 前端 `.log-line.faint`
  （暗青灰、居中、留白 —— 读起来是「晕过去了」而不是「被打死了」，与血红的 `.die` 分开）。
- **战斗路径补 `world.playerDeath()` 调用**（幂等：只标记 + 计数），昏倒数两条路一致。
- `modapi` 的 `die` 效果、`kidnap` 的「被打昏拖回来」也统一到 faint 语义。
- 状态面板新增一行 **「昏倒 N 次」**（`deathCount` 以前从没在界面上露过面）。
- **字段名保留** `dead` / `deathCount`（存档兼容），只有**玩家可见的文案**说「昏倒」。

### 「最近客栈」这件事：机制本来就是对的

先实测了一遍才动手（**别凭感觉改数据**）：

```
房间总数 320 | 客栈 6（江南/码头/洛阳/长安/成都/襄阳）
完全走不到客栈的房间数 = 0
>12 步才到客栈的房间数 = 0
```

`nearestInn` 是 BFS 最短步数，**320 个房间全部可达客栈，且没有一处超过 12 步**。
所以不需要加客栈、也不需要改选址规则 —— 用户要的「最近客栈苏醒」本来就是这个行为，
缺的只是**让玩家看出来自己只是昏过去**（文案 + 样式 + 结算透明）。

### 断言（`smoke-round3.js` §F，真链路）

真 `startCombat` + 真 `combatStep` 把自己打倒 + 真 `exec('look')` 触发苏醒流程。

| 断言 | 变异 | 结果 |
|---|---|---|
| F-1 / F-1b / F-1c 输出是 faint、**一个「死」字都没有**、旧的「倒了下去」不再出现 | 文案退回旧版 | **红** |
| F-2b ★ 落点 = **BFS 最近客栈**（与 `nearestInn` 同源比对） | — | 绿 |
| F-3 ★ 台词里的「银钱少了 N 文」**等于实扣** | — | 绿 |
| F-4 ★ 战斗中被打倒也计「昏倒数」 | `onDeath` 不调 `playerDeath` | **红** |
| F-5 ★ `world.playerDeath` 不再扣钱扣经验 | 加回扣钱 | **红** |
| F-6b ★ 饿昏/渴昏与战斗昏倒**同规则**（同样扣两成、同样落客栈） | engine 不调 `respawnAtInn` | **红** |
| F-7 结算只写在 `respawnAtInn` 里（engine 内联那份已删） | — | 绿 |

---

## B40 · mod 站 / 示例 mod / mod 制作器体检

### 根因（一条）

游戏本体的 `skills.type` 用的是**中文槽位名**（`拳/剑/刀/棍/鞭/暗器/内功/轻功/招架/身法`
—— 它同时是 `character.js` 的 `equippedSkills` 键，还决定「内功打坐 / 外功淬体」的分路），
而：

- **官方示例 mod** `mods/demo_skill/mod.json` 写的是 `sword / force / dodge`；
- **mod 制作器**的类型下拉，兜底数组写的是 `['fist','sword','blade','dodge','force','internal']`；
- 新建武学的默认值 `type: 'fist'`、`maxLevel: 100`（本体是 300）；
- 示例 mod 的 `taixu_hermit`「会教太虚剑意」，自己 `skills` 却是空的（演示反了）。

后果是**半静默失效**：玩家照着示例/制作器做出来的武学，`enable` 时只会得到
「没有「sword」这个槽位。可用：拳、剑、刀…」，武学面板里还会冒出一个叫 `sword` 的分类。
（`core/modfields.js` 头注释里写了完整推理。）

### 改法（四层，缺一层都不够）

1. **加载器归一化**（根）：新增 `core/modfields.js`，挂进 `world.buildIndexes()` 开头 ——
   这是 `boot()` / `reload()` / `deserialize()` **三条加载路径的必经点**（与 `applySpeciesMoves` 同一理由），
   挂一处等于全覆盖。归一化内容：`skills[].type` 英文/别名 → 中文槽位；
   缺 `category` 按槽位补五大类；补 `quality` / `maxLevel`（默认 300）/ 难度 / 命中 / 威力倍率。
   **幂等**（第二遍 `changed=0`），认不出的 type 原样保留（自定义槽位别乱改）。
   顺带把 `sects.skills` 键与 `npcs.skills` 键一起归位。
   ⇒ **存量 mod 与第三方教程抄过的写法一并救回来**，不是只修示例。
2. **制作器**（源头）：下拉兜底改中文；新增「分类（五大类）」字段；
   新建武学默认 `type:'拳'` / `category:'外功'` / `maxLevel:300`；
   提示语写明「type 必须选槽位名」。
3. **制作器侧归一化 + 校验**：
   - `normalizeSpec()` 里就地把 type/category 纠正 → **导出的 mod.json 从源头就是中文**；
   - `validateSpec()` 新增三类提示：类型是英文别名（已自动纠正为 X，建议改源文件）、
     类型不是合法槽位、没填/填错分类、等级上限过低（<60）；
   - `buildModFiles()` 的 `skills` 是**白名单式只挑字段**，原来**没有 category** ——
     制作器里填了会被**悄悄丢掉**，已补上 `category` / `quality`。
     ⚠️ 这条很关键：白名单漏字段 = 又一处「填了不生效」。
4. **官方示例 mod**：`demo_skill` 的武学改中文槽位 + 五大类 + 品质；
   `taixu_hermit` 补 `skills` / `learned`（现在他真会用「太虚剑意」了，
   原来只会基本拳脚）；`version 1.0.0 → 1.1.0`，desc 里把口径讲明白（它是教学范例）。

### mod 站：内容同步

`server/mod-site.js` 的 `seedOfficialMods()` 原来是：

```js
if (idx.mods.some(m => m.id === id)) continue;   /* 已有，不动 */
```

⇒ **改了示例 mod 只改了仓库，站点上仍是旧那一份**，玩家在模组站下载到的还是英文 type 的老版。
现在按**内容指纹**（`md5(JSON.stringify(json))`，不是 `version` —— 改了字段忘推版本号是常态）
对比，指纹不同就覆盖；只覆盖 `official: true` 的条目（玩家自己上传的同名 mod 不动）；
被手动删过的（`dropped`）依旧尊重不恢复。返回值加 `updated` 计数，幂等。

### 断言（`smoke-round3.js` §M）

| 断言 | 变异 | 结果 |
|---|---|---|
| M-1 / M-1b / M-1c ★ 示例 mod 的 type 全中文槽位、有五大类、NPC 挂了武学 | — | 绿 |
| M-2b ★ `enable` 真把示例剑法装进「剑」槽（写英文时这一步必失败） | — | 绿 |
| M-3 ★ 英文别名被纠正（sword→剑 / force→内功 / dodge→轻功 / blade→刀）+ 幂等 | 删掉 `sword` 别名 | **红** |
| M-4 ★ 制作器校验提示「写英文别名」+ 指出非法槽位 | — | 绿 |
| M-4c ★ 导出的 mod.json 带 category/quality | 导出时置 `undefined` | **红** |
| M-4e 编辑器元数据给出中文槽位表 + 五大类表（下拉的单一事实源） | — | 绿 |
| M-5 ★ 站点里的官方示例与磁盘一致（按同一指纹口径比对） | 站点条目改名 | **红** |

> ⚠️ 两点踩坑记录：
> ① **指纹口径必须两端一致**：`seedOfficialMods` 算的是 `md5(JSON.stringify(解析后))`（紧凑），
> 测试第一版拿**文件字节** md5 去比 —— 缩进不同，断言恒红。
> ② **M7 的变异一度「无效」**：改 seed 的指纹算法不会立刻改变站点数据（要跑 seed 才生效），
> 于是变异跑完用例照样绿 —— 那不是「断言无效」而是「变异无效」。
> 改成直接改站点数据（把示例 id 改坏）才验得动。

---

## 附：本轮改了哪些文件

| 文件 | 改动 |
|---|---|
| `game/src/core/modfields.js` | **新增**：字段归一化单一入口（type 别名表 / 五大类 / 幂等） |
| `game/src/core/world.js` | `buildIndexes()` 开头挂归一化；`playerDeath()` 只标记+计数 |
| `game/src/core/survival.js` | `respawnAtInn()` 成为唯一入口（结算 + 搬迁 + 昏倒/醒转文案） |
| `game/src/core/engine.js` | 饥渴昏倒走唯一入口；新增 `npcProfileOf()`；`editorMeta` 加 `skillCategories`；`normalizeSpec` 归一化武学/NPC 槽位；`validateSpec` 加四类武学提示；`buildModFiles` 补 `category`/`quality` |
| `game/src/core/combat.js` | 玩家 `onDeath` → faint 文案 + 调 `world.playerDeath()` |
| `game/src/core/commands.js` | `npcInsight`/`skillTierCN`/`SKILL_TIERS` 提到模块顶层并 `__api` 导出（单一口径） |
| `game/src/core/modapi.js` | `die` 效果统一到昏倒语义 |
| `game/src/core/kidnap.js` | 护院打昏那行改 `kind:'faint'` |
| `mods/demo_skill/mod.json` | 武学改中文槽位 + 五大类 + 品质；NPC 补 `skills`/`learned`；version 1.1.0 |
| `server/mod-site.js` | `seedOfficialMods()` 按内容指纹覆盖官方示例，返回 `updated` |
| `server/game-server.js` | 新增 `POST /api/npc` → `engine.npcProfileOf` |
| `game/src/renderer/js/app.js`(+镜像) | `api.npcProfile(uid)` |
| `game/src/renderer/js/ui.js`(+镜像) | NPC 菜单首项 →「细看此人」；`openNpcProfile` / `npcProfileHtml`；状态面板加「昏倒 N 次」；`__html` 导出 `npcProfileHtml` |
| `game/src/renderer/js/modmaker.js`(+镜像) | 武学页：兜底中文槽位、新增「分类」、默认 300、提示语；`newRowDefaults` 改中文 |
| `game/src/renderer/css/main.css`(+镜像) | `.log-line.faint`；`.npc-prof` 整套样式 |
| `game/src/renderer/index.html` | 版本戳 `?v=20261010p → q`（7 处一致） |
| `server/site-data/mods.json` | seed 自动同步（站点示例内容与新示例一致） |
| `tools/` | **新增** `smoke-round3.js`（37 项，§F 昏倒 / §M mod 字段）；`smoke-uiux.js` 加 §11（14 项，共 93 通过）；S1-9/S1-10 改到新行为 |
| `design/` | 本报告 + `12-owner-bug-list.md` 回填 B38–B40 |

---

## 仍未做（台账内，与主人已确认的优先级一致）

- **主线三~五幕**（`design/21`、`design/24`）：含 §2.9.1「绝顶内功门槛后移到第四幕之后」
  （要同时改 `q_main_jianghu` stage4/5 的 cond 与铜牌发放点），属结构性改动，需单独一批。
- `taixu_hermit`（太虚居士）目前来自**官方示例 mod**，而他是主线 `defeatLegend` 名单三人之一
  —— **主线依赖一个 mod** 不太健康，建议把这位挪进基础数据（或换一位基础数据里的名宿）。
- W5 余 56 条事件 / W6 三处 / W7 节庆当天人变多 / B22 余 7 条埋点 /
  B26 成就改判 / B29 `favor:<npcId>` no-op / 画像 `hooks`/`marks` 接线。
- 顺带发现（本轮未动）：NPC 模板里有**悬空物品引用**（如 `wen_huashan_shop` 的
  `carry.items: ["herb_ginseng"]`，而物品库里只有 `herb_lingshen/herb_xuecao/...`），
  会显示成英文 id。属数据缺口，建议随画像/内容批次统一扫一遍。
