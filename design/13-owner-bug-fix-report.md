# 13· 主人亲报 bug 修复报告（B4 / B5 / B6）

> 🚫 **本文件是历史记录（批次 1~8 逐批写就），其中的「遗留 / 未做」段落只反映当时状态，不要据它判断现状。**
> 已核实过期的说法（2026-10-10 深夜，见 `design/36-md-audit.md`）：
> 文中三处「**B8 仍未做**」→ **已修（批次 6）**；「B22 待修」→ **已接 9/16**；
> 「B5 触屏实机验未做」→ **仍成立（只能主人做）**。
> **最新现状以 `design/08`（§0/§1/§7）+ `design/12`（状态总览）为准。**

> 批次：OWNER-BUG-B4-B5-B6　范围：仅 B4、B5、B6（B1/B2/B3/B7/B8 不在本次）
> 原则：不改数据文件（`game/data/*.json`）· 不 commit · 断言打在真实调用路径上

---

## 摘要

| Bug | 主人原话 | 结论 | 改动|
|---|---|---|---|
| **B5** | 「战斗界面我依然能走，甚至带着和山贼的战斗界面能一路走回客栈」 | **已修**（第二轮返工：首轮漏了 2 条门禁，已补齐并做全仓穷举审计） | `commands.js` |
| **B6** | 「"回春堂后院"的"此地可做"有草药，点了却说此地没有草药，**这肯定不是个例**」 | **已修**（主人判断正确：全局查出 **5 类、60+ 处**同类问题） | `commands.js` + `modapi.js` + `engine.js` |
| **B4** | 「为什么战斗界面"全力一击"与"防御"快捷键点不了（如果废弃了可以删了）」 | **修好了，不是删掉**（两个都是后端缺实现/语义错，已补齐） | `commands.js` + `world.js` + `combat.js` |

新增测试 `tools/smoke-owner-bugs.js`：**145 通过 / 0 失败**
全量回归 **23 套全绿**（含此前已知有 3 项失败的 `smoke-social`，本次实测 82 通过 / 0 失败）。

> **本报告经质量负责人独立验收后返工修订（第二轮）。** 修订点见 §5「验收返工记录」：
> B5 首轮被判FAIL（漏了 `拜访` 这类 handler 内直调 `movePlayerTo` 的位移路径），
> 本轮补齐门禁 + 做全仓穷举审计；B6 有 7 条从「已修」降级为「内容缺口」。

---

## B5 · 交战中还能移动

### 真实根因

`game/src/core/commands.js` 第 98 行的 `doMove`（移动函数）**完全没有战斗态检查**。

原函数一进门就在算出口、查`ex.cond`、扣时间、`movePlayerTo` 换房间 —— 全程没有任何一处
问过「玩家现在是不是在打架」。于是战斗中按方向键，主角实打实地一步一个脚印走回了客栈。

### 战斗态读哪个字段（按铁律先验证，不猜）

先 `Object.keys()` 打了 `world` 的真实结构，结果是**两个近似字段名并存**：

```
world 的键: ...,combat, battle, ...
```

- `world.combat` 是 **`CombatEngine` 实例**（构造函数，来自 `combat.js`）—— 这是命名陷阱，
  `if (world.combat)` 永远为真，等于没判断；
- `world.battle` 才是**本局战斗的对象**（`startCombat`/`startDuel` 里赋值，
  `finishCombat`/逃跑成功时置 `null`）。

所以判据是 `!!w.battle`，与 `commands.js` 里既有的 `perform`/`flee`/`auto` 完全一致。
（这一点已写成断言 `0.1`~`0.5`，防止后人再踩 `world.combat` 那个陷阱。）

### 首轮修法（`doMove` 一处门禁）—— 但这个断言当时是**错的**

在 `doMove` 的**第一行**（任何位移/时间消耗之前）加战斗态门禁，并抽成
`COMBAT_MOVE_HINT` 提示常量。

提示按主人要求写清了「现在能干什么」：

> 你正与人交手，走不脱！想脱身得先把这桩了结：「kill <目标>」或「auto」进攻、
> 「perform <武学>」使绝招、「defend」凝神防守，或「flee」逃跑。

（其中 `defend` 就是 B4 补上的那条指令 —— 两个 bug 在这里接上了。）

首轮报告写的是「所有玩家自主位移都收敛 `doMove`，所以只堵一处即可」。
**这个断言在验收中被证伪**：当时只审了 `execute()` 的**解析路径**，
没有审各handler **内部**自己调位移的情况，于是漏了两条。
现改为**逐条列出的全仓审计表**（下一节），不再使用「全部收敛」这种说法。

### 一个连带修的坑

`go <房间名>` 的逐跳寻路原本是「走出第一跳的 travel 文本 → 继续下一跳 → 最后
`lookRoom` + `return { moved: true }`」。如果只在 `doMove` 里拦，会出现：玩家看到
「你沿路前往悦来客栈…」然后被拦，但**函数仍然返回 `moved: true`**，前端据此刷新界面，
误以为人已经到地方了。所以这条路径在进入循环**之前**就先探一次战斗态，拦下时给干净提示。

### 全仓位移路径审计（第二轮返工的核心交付）

首轮的错误在于**审计方法有漏洞**：只看了 `execute()` 的解析分支，
没看各handler 内部自己调位移。第二轮改用**穷举**：
遍历 `Object.keys(e.cmds.CMD)` 全表 **519 条已注册指令** + 4 个方向键 +
显式点名的移动类自然语言（`拜访`/`回家`/`传送`/`travel`/`warp`/`enter`/`exit`/
`骑马`/`乘船`/`突围`…），每条都在**新起一场干净战斗**的条件下真 `exec` 一遍，
前后对比 `p.room`，任何位移即记为漏网。

**审计结果：519 条指令实测 0 条漏网位移**（8 次位移被正确识别为 `kind:'die'` 死亡送医，非玩家自主）。

#### 全仓所有「能改变 `p.room`」的调用点，逐条列出

| # | 调用点 | 触发方式 | 是否玩家按键可触发 | 门禁覆盖 |
|---|---|---|---|---|
| 1 | `commands.js:167` `doMove` → `movePlayerTo` | 方向键 / `go`/`走`/`去` / 逐跳寻路 / 互动出口 | 是 | ✅ `doMove` 第一行 |
| 2 | **`commands.js:970` 拜访 handler → `w.movePlayerTo(p, r.roomId)`** | 玩家输入 `拜访 <人名>` | **是** | ✅ **本轮新增**（门禁放在 `visitHouse` **之前**） |
| 3 | **`home.js:352/363` `goHome` → `p.room = p.home`** | 玩家输入 `home`/`回家`/`回府`/`归家` | **是** | ✅ **本轮新增**（连 `movePlayerTo` 都不走，直接赋值） |
| 4 | `modapi.js:483/487` `goto`/`teleport` | mod 声明式 effect | 否（作者配置触发） | ❌ 有意不拦（见下） |
| 5 | `world.js:1995` `newGame` 起始位置 | 开新局 | 否 | — |
| 6 | `kidnap.js:1413` `playerCaptured` | NPC 绑架剧情 | 否（NPC 驱动） | ❌ 有意不拦 |
| 7 | `engine.js:845` + `survival.js:54` 死亡送医/复活 | 玩家气绝 | 否（死亡结算） | ❌ 有意不拦 |

#### 第2、3 条的漏洞细节（为什么首轮漏了、怎么被发现的）

- **第 2 条 `拜访`**：由质量负责人**真实跑通**（非推演）暴露。门槛只有
  `world.js:507-530` 的 `npc.favor >= 30`；用引擎自己的 `social.addFavor`
  把好感从初始 `-2` 合法攒到 38后，战斗中一句 `拜访 张掌柜` 即位移成功，
  且 `world.battle` 仍非空 —— **人走了战斗还挂着**，等于「一边打着山贼一边窜进别人家」。
  门禁必须放在 `visitHouse` **之前**：放晚了房间已经建好，白跑一趟，
  还会留下一个凭空多出来的私域。
- **第 3 条 `回家`**：**本轮我自己审计时发现的第二条同类漏网**。
  `goHome` 连 `movePlayerTo` 都不走，是**裸赋值** `p.room = p.home`，
  首轮的「都收敛到 `doMove`」断言对它完全不适用。

#### 为什么不把门禁锁在 `movePlayerTo` 上

`world.movePlayerTo`（`world.js:1451-1465`）是**刻意**不做战斗态检查的收敛点 ——
因为它还接着第 4~7 行的**非玩家自主**位移（mod 传送 / NPC 绑架 / 死亡送医 / 剧情传送）。
锁它会把这些一起锁死，那是比现在更严重的问题。
所以取舍是：**只在「玩家自己按键能触发」的三条路径（第 1、2、3 行）上加门禁**。

### 明确评估的几条旁路

- **战斗中允许「原地不动」类指令吗？→ 允许，且已断言。**
  `look` / `i` / `背包` / `score` / `状态` / `skills` / `quests` / `affects` / `map`
  在战斗中全部照常工作 —— 它们不碰 `doMove`，不受门禁影响。已写成断言 `B5-4`逐条验证。
- **`拜访`（visitHouse，上门拜访）→ 战斗中不产生位移（第二轮补上门禁）。**
  首轮这里写的是「即使成功进门也不拦它，**这是有意的**」—— **这个判断是错的**，
  验收已证伪：`拜访` 是玩家按键可触发的，且门槛不高（好感 ≥ 30 可合法攒到），
  等于一条稳定的脱战位移后门。现已在 handler 第一时间拦掉（见审计表第 2 行）。
- **`传送`/ mod 的 `teleport`/`warp` → 有意不拦。**
  理由与门禁位置见上方审计表末节。mod 自定义指令（`customCommands`）注册在方向分支之后，
  不走 `doMove`，行为未变。

### 1.4 ⚠️ 未完成：**B5 必须补触屏实机验（桌面端不算数）**

这是质量负责人在验收报告中**保留的待办，本轮未完成，不得当已完成**。

B5 的门禁全部在后端（`commands.js`），桌面端回归已全绿；
但**触屏路径只能靠读代码判断，无法用现有自动化验证**：

- `ui.js:2009-2016` `isTouchDevice()` —— 触屏分支的判定与行为；
- `ui.js:2019-2032` `blurCmdInput()` —— 战斗中点按钮后输入框的失焦处理，
  直接决定「点方向键/点移动按钮会不会误把输入框糊住、进而吞掉指令」。

**这两段分支目前只做了代码走查，没有实机验证。批次 1 放行前必须补真机触屏验证。**
建议验收路径：真机进入战斗 → 依次点方向键、`go`、`拜访`、`回家`、`防御`按钮，
以及战斗面板全部 4 个快捷键，确认每一条都不产生位移且输入框状态正常。

---

## B6 · 「此地可做」有草药却点不动

### 真实根因（不是一个，是三层，都验证过）

主人猜测「渲染读的字段和判定读的字段不是一个」—— **方向对了，但具体机制比想象的更靠前**。
前端渲染读的字段是对的：`engine.roomActionsView()`（`engine.js:447`）遍历 `room.actions`，
给出 `{ name, cmd, ok }`，按钮点下去执行的就是 `a.cmd`（`ui.js:207-216`）。
问题出在**后端解析顺序**：

#### 根因 1· 内置指令表排在房间 action 前面（主因）

`commands.js` 的 `execute()` 解析顺序是：

```
1) 内置指令 CMD 表  →  2) 方向  →  3) roomCmd  →  4) questKeyword
```

**内置指令表排在房间 action 前面。** 于是只要一条 action 的动词撞上内置指令，
这条 action 就被整条吞掉，作者写的 `effects` 永远不会执行。

全量实测（`50_map.json` 共 **128 条** room action）：

- **48 条** action 的动词是内置指令；
- 其中 **27 条**是多词 cmd（`get 药材`、`talk 郎中`、`list 当铺`、`work 打铁`…）——
  这些是最典型的「按钮在、点了说没有」；
- 回春堂·后院那条正是 `cmd: "get 药材"`，而 `get` 是内置指令，于是必然被吞。

#### 根因 2 · `questKeyword` 只拿首词比对，多词 cmd 永远匹配不上

`questKeyword(ctx, cmd0, args)` 里做的是 `a.cmd === cmd`（严格相等）和
`keywords.some(k => cmd.includes(k))`，可 `cmd` 是**首词**。
所以 `a.cmd = "listen 说书"` 永远不可能等于 `cmd = "listen"`。
实测 **7 条**这类 action 全部返回「「listen」是什么指令？」——纯静默失败，连warn 都没有。

#### 根因 3 · 采集类 action 语义悬空

`get 药材` / `get 稻种` 这类 action **既没有 `effects`，房间也没放 ground item**
（`50_map.json` 里 0 个房间有 `items` 字段）。就算让它匹配上，
`get` 也只能去 `pickupItem` 里找 —— 找不到，就只能报「这里没有「药材」」。
**这不是字段不一致，是这条 action 从设计上就没有兑现路径。**

### 全局排查结果：共 **5 类**，全部一并修掉

> ⚠️ **重要限定（第二轮验收补充）**：上表第 2 类那7 条，
> **不要理解成「对话写好了」**。详见下方 §「第 2 类的真实性质：内容缺口，不是 bug 修复」。

修在归一化入口（`execute` / `questKeyword` / `evalEffect`），**不是逐处打补丁**。

| # | 问题 | 数量 | 位置 | 修法 |
|---|---|---|---|---|
| 1 | 内置指令吞掉自带 effects 的 action | 2 条实际发作 | `palace_gate`「talk 禁军」（写了 effects 却被内置 talk 吞，玩家永远看不到那两句写好的台词） | `execute` 新增 `selfSuffRoomAction()`：**自带 effects 的 action 优先于内置指令**。不带 effects 的仍交给内置指令（`harvest`/`sell`/`d`/`打坐` 是**故意**委托的，不能抢） |
| 2 | 多词 cmd 匹配不上（静默失败） | **7 条** | `listen 说书`、`read 告示`、`knock 登闻鼓`、`search 书架`、`listen 戏`、`read 石壁`、`knock 钱府` | `questKeyword` 改用**整条输入串**参与匹配，认`a.cmd === full` / `ac.startsWith(full)` / keywords 互含。⚠️ **效果仅到「解析不再被吞」，见下方说明** |
| 3 | 采集类 action 无兑现路径 | 2 条 | `jn_pharmacy_back`「get 药材」、`jn_farm_shed`「get 稻种」 | 新增 `gatherRoomAction()` + `GATHER_ALIAS` 归一化：按「此处可采」语义兑现成真物品。**已校验「本房间确实声明了这条 action」**，所以不会抢走普通「捡地上东西」 |
| 4 | action 无 effects → **零行输出**（界面一片空白） | 3 条 | `look 牢门`（衙门·监狱）、`look 槐树`（青溪村）、`fish`/`gather` 类若干 | `questKeyword` 与 `look` 两条路径都不再返回 `evalEffects([])`，改为给一句明确的落空说明 |
| 5 | `{type:'cond', if, then, else}` 写法被忽略 | 1 条 | `jiangnan_temple`「搜查」（**整条剧情都写在这个 effect 里**：布包+残页+50 经验） | `modapi.evalEffect` 补上带 `type:'cond'` 的条件包装分支。原来只有 `!eff.type` 的写法被认，带 `type` 的掉进「纯条件→忽略」分支返回空数组 |

**排查中额外发现并修掉的两个真·崩溃/静默 bug**（同属「按钮点了没反应」这一类，
但根因完全不同，值得单列）：

- **`TypeError: l.text.includes is not a function`（整条指令直接崩）**
  `modapi.js` 的 `wait` 效果把**数字**塞进了 `text`：`{kind:'wait', text: 600}`。
  于是 `engine.postProcess` 的 `l.text.includes('气绝')` 在任何含 `wait` 的房间
  一执行就抛异常 —— 整个 `exec` 崩掉，玩家看到的是**界面完全无响应**。
  受影响的是所有带 `wait` 效果的 action：`采药`、`练武`、`练剑`、`研究暗器`、`寒玉床` 等 5 条以上。
  修法：① `modapi.js` 把载荷挪到 `ms` 字段、`text` 置空串（语义更对——它是控制指令不是文本）；
  ② `engine.js` 加 `typeof l.text === 'string'` 防御（**别的地方也会塞非字符串进来**）。
- **`failMsg` 措辞**：`look` 路径的落空提示写成「你细看了看，此处暂无更多可看的了。」

### 第 2 类的真实性质：**内容缺口，不是 bug 修复**（第二轮验收订正）

首轮报告把这 7 条多词 cmd 记作「已修」，**这个表述会误导主人**，现更正如下。

**代码侧确实修好了的部分**（可验证）：
- `palace_gate` 的台词真出来了 —— 那是第 1 类（自带 `effects` 被内置 `talk` 吞），
  数据里**有** `effects`，修完玩家真能看到写好的那两句。
- `get 药材` 真采到灵芝 —— 那是第 3 类，`gatherRoomAction` 给它补了兑现路径。
- 这 7 条多词 cmd **解析不再被吞**：改之前它们返回「「listen」是什么指令？」纯静默失败；
  改之后能匹配到 action、走 `evalEffects`。

**但代码侧修不到的部分**（必须补内容才能好）：
- 这 7 条 action 的数据里**根本没有 `effects` 字段** —— 全库34 条多词 action 里
  **只有 1 条**有 `effects`。也就是说修完它们只是走到了「零行兜底」分支，
  玩家看到的是一句「你留心察看了一番，此处暂时没有更多可做的了。」，
  **而不是设计者预想的剧情台词**。

**结论定性**：
-✅ 记为修复：解析层不再静默吞掉指令（原本是明确的 bug）。
- ⚠️ **记为内容缺口，不是 bug 修复**：这 7 条缺 `effects`，**需后续补台词**。
  若主人看到报告以为「拜 listened 说书现在有内容了」，那是本报告第一轮的错。
- 为什么不在本批直接补：台词属于内容创作，且**本批边界是不改 `game/data/*.json`**。

**排查后仍存在、但不属于本批范围的（如实列出，不擅自扩大改动）**：

明细已由测试 `B6-3` 自动打印（21 条），绝大多数是**数据缺口**而非代码不一致——
「这里没有做买卖的人」是因为那些铺子**根本没有商人 NPC**
（如 `jn_pharmacy` / `jn_silk_shop` / `jn_school` 在 `40_npcs.json` 里 0 个 NPC），
`list 当铺` 只是找不到卖家；`talk 郎中` 同理。这些要**加 NPC 数据**才能解决，
属于内容缺口，不该在「渲染/判定一致性」这批里偷偷改数据。
另有 `work 后厨` / `serve`（青楼）/ `harvest`（没种东西）等**本就是正确行为**。

---

## B4 · 「全力一击 / 防御」快捷键点不了

### 结论：**修好了，不是删掉**

按「按钮点了没反应三查」逐条查，结论是**两个按钮都不是僵尸按钮**，所以都保留：

| 按钮 | ① 事件绑了没 | ② 读字段对不对 | ③ 元素渲染没 | 真实结论 |
|---|---|---|---|---|
| 全力一击 | ✅ `ui.js:2236` `onclick → doCmd` | ✅ `data-cmd="attack"` | ✅ 真渲染（`view.combat` 非空时走战斗分支） | **③都正常，坏在后端语义** |
| 防御 | ✅ 同上 | ✅ `data-cmd="defend"` | ✅ | **后端压根没有 `defend` 指令** |

- **`defend`：后端完全没有这条指令。**
  实测 `CMD.defend === undefined`，`exec('defend')` 回「「defend」是什么指令？」
  —— 这就是主人看到的「点了没反应」。
  **补齐后端**：新增 `reg(['defend','防御','招架','守'])`，
  `combatStep` 增加 `{type:'defend'}` 分支，效果是**本回合受到的伤害减半**。
  用 `battle.guardTurns` 挂在**战斗对象**上而不是玩家身上 —— 这样多人群战只对这一局生效，
  战斗结束随 `battle` 一起丢弃，不会像 `bossPhaseIdx` 那样漏清（见 `finishCombat` 的复位清单）。
- **`attack`：后端有这条指令，但语义错了。**
  `reg(['kill','fight','attack',...])` 第一句就是`if (!args.length) return「你想攻击谁？」`，
  而战斗面板里的对手是**已知的**（`w.battle.target`），玩家不该再输一遍名字。
  **改成：交战中无参数 = 朝当前对手出手**（走 `combatStep` 的普通攻击分支）。
  非战斗时 `attack` 仍回「你想攻击谁？」—— 正常提示没被改坏（已断言 `B4-3`）。

### 实测证据

```
defend 减伤（同 seed、同一记敌方普攻，唯一差别是是否布防）：
  无防守 = 187  有防守 = 91ratio ≈ 0.49   ✔ 约一半
防守只保本回合：guardTurns 守完即被消费 = 0     ✔ 不会变成永久减伤
前端真渲染真点击：4 个按钮，点「防御」→ 发出 defend → 后端 CMD 里确实存在 defend
```

### 补充断言（第二轮按验收要求新增）

验收指出首轮测试没针对「精确减伤」与「守完即消费」两点断言，
并明确警告：**若 `guardTurns` 哪天被误挂到 `player` 上，会变成永久减伤而没有测试能发现。**
已补三条断言 `B4-5(a)/(b)/(c)`：

| 断言 | 内容 | 实测 |
|---|---|---|
| (a) | **固定 rng 后的精确比值**（消除 0.85~1.15 随机浮动，断言精确等于 0.5） | `ratio = 0.5000` |
| (b) | **连续两回合**：第1 回合守完 `guardTurns` 被消费为 0；第 2 回合伤害恢复为第 1 回合的 2 倍 | `第1回合=267第2回合=534`；`guardTurns=0` |
| (c) | **结构性防回归**：`guardTurns` 挂在 `battle` 上而非 `player`；`finishCombat` 后 `battle` 整体丢弃、玩家无残留 | `battle.guardTurns=1 player.guardTurns=undefined` |

---

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `game/src/core/commands.js` | B5：`doMove` 战斗态门禁 + `go <房间名>` 前置拦截 + `COMBAT_MOVE_HINT`；**第二轮：`拜访` handler 门禁、`回家` 门禁**；B4：`attack` 战斗语义、`defend` 新指令；B6：`selfSuffRoomAction` / `gatherRoomAction` / `resolveGatherable` / `GATHER_ALIAS` / `execute` 解析顺序 / `questKeyword` 全串匹配 / `look` 零行兜底 |
| `game/src/core/world.js` | B4：`combatStep` 的 `defend` 分支；`stepEnemyOnly` 末尾消费 `guardTurns` |
| `game/src/core/combat.js` | B4：`oneAttack` 里 `guardTurns > 0` 时伤害减半 |
| `game/src/core/modapi.js` | B6：`{type:'cond', if, then, else}` 写法支持；`wait` 效果载荷不再污染 `text` |
| `game/src/core/engine.js` | B6：`postProcess` 加 `typeof l.text === 'string'` 防御（防同类崩溃） |
| `tools/smoke-owner-bugs.js` | **新增**，145 项断言 |
| `game/src/renderer/js/ui.js` / `server/public/js/ui.js` | **未改动**（B4 是后端缺实现，前端按钮本身是对的；两份副本已断言逐字节一致，无需同步） |

**数据文件零改动**，`game/data/*.json` 未触碰。

---

## 测试结果

### 新增测试：`tools/smoke-owner-bugs.js` —— **145 通过 / 0 失败**

| 组 | 内容 |
|---|---|
| 0 | 前置事实：`world.combat` 是 CombatEngine、`world.battle` 才是战斗态（打真实结构，不猜字段） |
| B5 | 全部方向键 + 中文方向 + `go`/`走`/`去` + 逐跳寻路 + 互动出口，全部走不脱；提示内容含四个脱战手段；战斗中 9 类面板指令 + `map` 不受影响；`flee` 后移动恢复；**B5-8 真拜访**（好感喂过门槛，真走进 `visitHouse`，断言位移/房间数/战斗态均未变，脱战后可正常进门）；**B5-9 回家门禁**；**B5-10 全仓穷举 519 条指令审计，0 漏网** |
| B6 | 回春堂·后院本体 + 稻种同类 + **全量 128 条action 逐条真exec**（断言「未识别指令」=0、「零行输出」=0、采集类「这里没有」=0）+ **回归：普通 `get` 捡地上物品不被抢走**（ground 实例必须被消耗）+ 7 条多词 cmd + `talk 禁军` + `look` 零行 |
| B4 | 后端字段实测 + `attack` 战斗/非战斗双路径 + `defend` 减伤（公平对照组 + **B4-5(a) 精确 0.5** + **B4-5(b) 连续两回合守完即消费** + **B4-5(c) 挂在 battle 非 player**）+ 前端两份 `ui.js` 逐字节一致 + 版本戳 7 处一致 + **vm 加载真 ui.js 真渲染真点击** |
| FE | 快捷键 4 按钮渲染；点「全力一击」「防御」发出的指令**必须是后端已注册指令** |

### 全量回归：23 套全绿（22 套既有 + smoke-owner-bugs）

```
smoke-estate 48 · smoke-martial 52 · smoke-sect 21 · smoke-combat 58 · smoke-portrait 127
martial-ui-check 47 · game-ui-check 80 · ui-bind-check 77 · mapguide-check 72
input-guard-check 19 · map-check 6278 · smoke-rumor 32 · smoke-kinsman-witness 33
smoke-tutorial 44 · smoke-mainline 47 · smoke-boss 66 · smoke-act2 143
smoke-guards 32 · smoke-ux-fixes 43 · smoke-social 82 · smoke-kidnap 51
smoke-visit-house 35
```

- **已知预存失败：0 项。** 交底里提到 `smoke-social` 有 3 项预存失败（NPC的
  likes/支线/teach 字段未填满），本次实测 **82 通过 / 0 失败** —— 已全绿，
  无需 `git stash` 对比基线。
- 由于本批额外动了 `modapi.js` 与 `engine.js`（影响面比原定的两个文件大），
  **23 套在第二轮改动后完整重跑过一次**，全绿，**0 失败零红项**。

---

## 7 · 验收返工记录（第二轮，供追溯）

| 轮次 | 问题 | 处置 |
|---|---|---|
| 第 1 轮 | 报告断言「所有玩家自主位移都收敛 `doMove`」 | **证伪**。只审了 `execute()` 解析路径，没审 handler 内部 |
| 第 1 轮 | `拜访` 可脱战位移（`commands.js:970` 直调 `movePlayerTo`） | 验收真实跑通暴露 → 已加门禁（`visitHouse` 之前） |
| 第 1 轮 | — | **本轮自查又发现第二条漏网**：`回家`/`goHome`（`home.js:352/363` 裸赋值 `p.room`）→ 已加门禁 |
| 第 1 轮 | `smoke-owner-bugs.js:203` 的 B5-8 是**假绿** | 原用无参数 `exec('拜访')`，在 `commands.js:957` 就 return，压根没走到 `visitHouse`，`p.room === before` 在任何实现下都成立 → 已重写为真拜访 |
| 第 1 轮 | 审计方法有漏洞（列了几个入口就下结论） | 改为**穷举 `CMD` 全表 519 条 + 方向键 + 移动类自然语言**，每条在干净战斗态真exec，实测 **0 漏网**；已固化为常驻断言 `B5-10` |
| 第 1 轮 | B4 缺「精确减伤」「守完即消费」断言 | 已补 `B4-5(a)/(b)/(c)`（含防「误挂到 player 变永久减伤」的结构性断言） |
| 第 1 轮 | B6 那 7 条多词 cmd 被记作「已修」 | **降级为内容缺口**：解析不再被吞，但数据缺 `effects`，需后续补台词 |

---

## 遗留与建议（未做，需主人拍板）

1. **21 条「这里没有做买卖的人 / 这里没有「郎中」」** —— 根因是那些铺子
   **没有商人 NPC 数据**（`40_npcs.json` 里 `jn_pharmacy`、`jn_silk_shop`、
   `jn_school` 均0 NPC）。这是**内容缺口**，不是代码 bug，建议单开一批补 NPC，
   不要混进一致性修复里。
2. **`GATHER_ALIAS` 是人工对照表**，目前 4 组（药材/草药/药→灵芝、稻种/种子→稻种、菜种→菜种）。
   若后续新增采集类 action，需同步补这张表；解析不出时**老实不处理**（回落到原有报错），
   不会硬塞物品。
3. **`defend` 的减伤幅度（50%）是拍的**，若不合手感可在 `combat.js`
   `oneAttack` 的 `guardTurns` 分支里一行调整。
4. B1/B2（存档列表混进「测试侠客」、点「继续游戏」不直接进最近档）与
   B8（NPC 只会基本拳脚，主人钦定推迟到画像之后）**均未触碰**。
5. **🔴 B6 的 7 条多词 cmd 缺 `effects`（内容缺口，非代码问题）** ——
   `listen 说书`、`read 告示`、`knock 登闻鼓`、`search 书架`、`listen 戏`、
   `read 石壁`、`knock 钱府`。解析已修好，但数据里没有台词。
   建议单开一批补 `effects`，**不要记成 bug 修复**。
6. **🟡 B5 触屏实机验未做** —— 见 §1.4，批次 1 放行的前置条件。---

---

# 批次 2 · B1 / B2 / B7 / B3

> 记录时间：2026-10-10（第 3 轮，工程负责人交接后）
> 执行顺序：**B1 → B2 → B7 → B3**（顺序不可换，理由见 `design/13-bug-triage.md`）
> 回归判据：**23 套全绿 / 6792 通过 / 0 失败**，`smoke-owner-bugs` 由 145 增至 **196 通过**（+51）

本批次开工前先做了一件事：**把批次 1 遗留的两处「假绿 / 弱门槛」修掉**，
否则本批次的新断言会被同一批假绿污染（详见 §0）。

---

## 0 · 先修批次 1 的两处假绿（本批次的可信度前提）

### 0.1 `B5-8` 是恒真空断言

**位置**：`tools/smoke-owner-bugs.js:246-248`（批次 1 遗留）

**真实根因**：谓词末尾挂了 `&& false`，整个谓词**恒为 false**，取反后**恒为 true**，
所以任何实现下这条断言都通过。实测把 `commands.js:966` 的战斗门禁 `if (w.battle) return`
改成 `if (false) return`（真脱战成功、`house_` 房间数真的 0→1），它**依然显示 ✔**。
这是批次 1「假绿重演」的第二次实例。

**修法**：按验收报告 `design/14-batch1-acceptance.md` §8.7 改成**前后 count 对比** ——
在 `exec('拜访 ' + t.name)` 前后各数一次 `house_` 前缀房间数，断言 `houseAfter === houseBefore`。

**变异自证**：摘掉门禁 → `142 通过 / 3 失败`（新断言如实报 `0 -> 1`）→ 还原 → `145 通过 / 0 失败`。

### 0.2 `B5-10` 的门槛 `tested > 400` 恒真

**位置**：`tools/smoke-owner-bugs.js`（B5-10）

**真实根因**：`CMD` 表主体本身就有 486 条，`tested > 400` 只能防「探针表被整体清空」，
防不住「删掉某几条移动探针」。

**修法（踩了两个坑才做对）**：

1. 按验收 §8.3.3 改成 `tested >= Object.keys(CMD).length` —— **仍然不够**。
   探针表额外追加了约 40 条方向键 / 自然语言探针，从探针表删掉 `go`/`walk`/`travel`
   后总数依然 ≥ 486，实测**仍然全绿 145/0**。
2. 最终改为**集合包含关系**：`missing = CMD 全表 filter (不在探针集合里)`，
   断言 `missing.length === 0`。报红时直接打印漏掉了哪几条。

**变异自证**：删掉 `go` 探针 → `144 通过 / 1 失败`（`漏掉 1 条: go`）→ 还原 → `145/0`。

---

## 1 · B1 · 存档列表混进「测试侠客」

### 真实根因（两层，缺一不可）

**第一层 · 源头污染**：`tools/smoke-test.js:65` 的 `engine.save(...)` 用的是
`GameEngine` 的**默认 `saveDir`** —— 也就是**玩家自己的 `saves/` 目录**。
所以每跑一次 smoke 测试，就往玩家目录裸写一个测试存档（角色名「测试侠客」）。
历史遗留文件 `saves/test_slot.json` 即由此而来。

**第二层 · 列表无过滤**：`game/src/core/engine.js` 的 `listSaves()` 原本对
读到的每一个 `.json` **无任何过滤**，直接按 `savedAt` 降序返回 —— 只要文件在盘上就一定被列出。

### 修法（源头隔离 + 列表过滤，双层）

1. **源头**：新建 `tools/_test-save-dir.js`，导出 `os.tmpdir()/jinyong-mud_test-saves`。
   `tools/smoke-test.js` / `smoke-act2.js` / `smoke-saveload.js` 的
   `new GameEngine({ …, saveDir: TEST_SAVE_DIR })` 全部改指沙盒；写档改用 `save(id, { _test: true })`。
2. **列表**：`engine.js:48-49` 新增常量
   `TEST_SAVE_PREFIXES = ['test_','smoke_','_inst_','_local_','tmp_']`、`TEST_SAVE_IDS = new Set(['test_slot'])`；
   `engine.js:977` 新增 `_isTestSave(id, j)`，两条**严格度不同**的判据：
   - 名单内的 id（`test_slot`）→ **按 id 直接挡，不看正文**；
   - 前缀命中的 → **必须同时**正文带 `_testMark` 才算测试档，
     以免误杀玩家自己手打的 `test_xxx` 存档名。

   `listSaves()`（`engine.js:991`）逐条过滤。
3. `save()`（`engine.js:1012`）支持 `{ _test: true }`：自动补 `test_` 前缀 + 写 `_testMark`。

### 验收（B1 的验收标准不是「删掉测试档」，是「首行仍须是正确的最新档」）

- **B1-1** 列表里没有任何 `test_slot|smoke_|_inst_|_local_`；
- **B1-1** 列表里没有角色名「测试侠客」的档；
- **B1-3 首行就是磁盘上 `savedAt` 最大的那一档**（排序未被测试档污染）；
- **B1-3 首行不是测试档**；
- **B1-2** 带 `_test` 标记写出的档不出现在列表里；**未标记的正常存档仍能列出**（防「过滤误杀」）。

实测：`test_slot` 已从列表消失，首行变为 `save_2026-10-09T15-52-38`（试剑）。

**变异自证**：`listSaves()` 的过滤关掉 → `190 通过 / 5 失败`（B1-1/2/3 全红，`list[0]=test_slot`）。

---

## 2 · B2 · 点「继续游戏」不直接进最近档

### 真实根因

**位置**：`game/src/renderer/js/start.js:206` 的 `continueGame()`。

原实现全程只做三件事：拉 `api.saves()` → 判空 → `U.openSaves('load')`。
**函数体内没有任何一处自动载入调用**（没有 `api.load`），所以必然跳去读取存档界面要手动点。
不是排序问题，是**根本没载入**。

### 修法

`continueGame()` 改为：拉列表 → 判空（无档只 `U.toast` 提示，**不跳转**）→
取 `local[0]`（`listSaves()` 已按 `savedAt` 降序，首项即最新）→ `await api.load(latest.id)` →
`U.clearLog()` + `U.appendLog()` + `U.renderAll()` + `U.show('game')` + `bus.emit('gamestart')` → 刷新存档面板。
失败走 `catch`：`U.toast(..., 'error', 4000)` 后 `U.openSaves('load')` 兜底，不静默卡死。

### 断言：**vm 行为测试**，不是静态 grep

**这里有一次自我打脸，必须记下来。**
第一版断言是「静态 grep `start.js` 里有 `api.load`」。变异体在 `const latest = local[0];` 后插入
`if (latest) { U.openSaves('load'); return; }` —— `api.load` 那行**仍在源码里但永远走不到**，
结果**仍然 195 通过 / 0 失败**。静态源码 grep 断言是假绿重演的第三例。

**修法**：把真 `start.js` 载进 `vm` sandbox，用桩替掉 `api` / `WXUI` / `document`，
**真调一次 `WXSTART.continueGame()`**，记录它到底调了哪些 API，据此断言：

- `B2-3` 直接 `api.load` + `U.show('game')`，**没有**先 `U.openSaves`；
- `B2-4` 载入的是列表首项（最新档）；
- `B2-5` 无存档时只 toast，不载入不跳转；
- `B2 容错` 载入抛错时给提示并退回列表。

另配引擎侧断言：`B2-2` 列表首项 `savedAt` 最大、`B2-4` 读回来的内容是最新档而非更旧的、
`B2-4` **载入的不是测试侠客**。

> 排障记录：一版断言写 `j2.savedAt = 9999999999` 当「最新」，但 `Date.now()` ≈ 1.79e12 更大，
> 结果 `b2_old` 反而排首行 —— 造「最新」必须用**当前时间量级**，已改为 `Math.max(j2.savedAt, Date.now()) + 60000`。

**变异自证**：退回「只开列表」→ `191 通过 / 5 失败`（重写为 vm 测试后才抓住；静态版漏检）。

---

## 3 · B7 · NPC 目睹玩家被袭击无反应

### 真实根因：**三层叠加**，缺任何一层都表现为「没反应」

**第一层 · 钩子零监听**
`world.js` 的 `startCombat()` 里 `this.emit('combatstart', { battle })`
（现 `world.js:1663` / `world.js:1708`）**全仓零个 `.on('combatstart')`**。
事件发出去就沉了 —— 这是台账里点名的直接根因。

**第二层 · 台词走的通道在产品侧没人接**
反应树里台词用 `this.emit('storyline', ...)` 抛出，但 `storyline` 事件
**全仓只有 `tools/smoke-ecology.js` 和 `tools/smoke-kinsman-witness.js` 在监听**，
产品侧零消费者 → 即使第一层接上、反应也发生了，**玩家屏幕上仍然一个字都看不到**。

**第三层 · 性格分流从未生效（隐藏根因）**
`game/src/core/personality.js` 的 `PERSONALITIES` **九条原本都没有 `id` 字段**，
而所有调用方写的是 `per.id === 'qienuo'` / `per.id === 'xiayi'` —— **恒 false**，
所有按性格分流（怯懦要逃、侠义要打）**全是死代码**。这一层不修，接上钩子也只是「无差别说话」。

### 修法（接线 + 复用现有反应树，不复制逻辑）

- **接线**：`world.js:172` 构造函数注册
  `this.on('combatstart', ev => { … this.combatStartWitnessReaction(ev && ev.battle) … })`，
  结果暂存到 `this._combatWitnessLines`。
- **抽出共用反应树**：`world.js:1053` 新增 `witnessTree(w, personalityMod, foeName, playerIsVictim)`，
  把分支判断从既有 `witnessReaction` 里抽出来，两者**共用同一棵树**（不是复制一份）。
  官府分支按 `playerIsVictim` **镜像**：玩家是受害者时台词改为「制止凶手」，
  **绝不**记通缉 —— 否则玩家挨打反而 `wanted + 1`，与设计意图彻底反向。
- **目击者筛选 + 行为**：`world.js:1095` 新增 `combatStartWitnessReaction(battle)`：
  滤掉凶手本人 / `dead` / `knockedOut` / `hostile` / `inCombat` 的，再逐个调 `witnessTree`；
  怯懦者**真调** `fleeNpc`（会真的换房间）；侠义且有武力者**真** `battle.attackers.push(w)` 加入战斗。
- **台词回传**：`startCombat`（`world.js:1711`）把 `_combatWitnessLines` 清空并**放进返回值** `lines`；
  `commands.js:1790` 的 `kill` handler 遍历 `r.lines` 并进本次输出。
- **补 id**：`personality.js:19-20` 起，9 条 `PERSONALITIES` 全部补上 `id` 字段。

### 防假绿：走真实触发路径

验证用**真 `exec('kill ' + foe.name)`** 让战斗真的建立。
（中途踩过一次坑：先用 `exec('动手 ' + f.name)`，该动词不存在，返回「『动手』是什么指令？」，压根没触发。）
**基线对照**用「NPC 挨打」（`onNpcDown` 老路径）确认没被改坏，**靶心**用「玩家挨打」。

关键断言：

- `B7-2` 战斗真的建立且目标是那个敌对 NPC
- `B7-2` 交战瞬间有非参战 NPC 的反应输出
- `B7-3` 怯懦目击者**真的离开房间**（`fleeNpc` 生效，不只是说了句「逃」）
- `B7-4` 侠义目击者**真的进了 `battle.attackers`**
- `B7-5` 至少一条非「已发起攻击」的台词
- `B7-6` 玩家是受害者时 `wanted` 不变
- `B7-7` 凶手自己不在反应名单里
- `B7-基线` NPC 挨打仍触发（老路径没坏）
- `B7-性格` `PERSONALITIES` 每条都带 `id`

实测：怯懦者真的从 `jiangnan_street` 移到 `jiangnan_market`；侠义者真的进 `battle.attackers`；
官差台词为制止凶手；玩家 `wanted` 不变。

**变异自证**：

- 摘掉 `combatstart` 钩子 → `190 通过 / 5 失败`（B7-2/3/4/5 全红）
- 摘掉 `PERSONALITIES` 的 `id`（还原成死代码）→ `191 通过 / 4 失败`（B7-3/4 + 性格 id 断言红）

---

## 4 · B3 · 毒蛇只会「基本拳脚」

### 真实根因

**位置**：`game/data/` 里蛇类 NPC（`mob_snake`）的技能配置是 `skills: { 拳: "basic_fist" }`；
而 `combat.js` 的 `pickSkill(u, t)` **只认 `equippedSkills` 的六个槽位**
（`剑 / 刀 / 棍 / 鞭 / 暗器 / 拳`），且**蛇类专属招式在整个数据里根本不存在**
—— 既没有招式定义，也没有 NPC 引用。所以每回合必然落到「拳」槽的 `basic_fist`。

约束：**`game/data/*.json` 一个字都不能改** —— NPC 数据缺口是另一批的活。
所以修法必须是**代码侧注入**。

### 修法（新增物种招式系统，同时作为 B8 的实现模板）

- **新建 `game/src/core/bestiary.js`**：`SPECIES_MOVES`
  （snake 三招：`snake_fang` 毒牙噬咬 / `snake_coil` 缠身绞杀 / `snake_spit` 信子吐信；beast 一招占位）+
  `SPECIES_RULES` + `speciesOf(def)` **三级识别**（显式 `species` 字段 → id 前缀 → 名称 / 描述关键词）。
- **注入点 `world.js:2347` `applySpeciesMoves()`**：把招式定义写进 `data.skills`
  （已存在同 id 则跳过）→ 按 `speciesOf(def)` 给 NPC 模板写 `speciesMoves` 并补 `learned`
  （保底 level 60，不覆盖作者设定；模板已有 `speciesMoves` 则不覆盖，留给 mod）。
  挂载点选在 **`loadMods()` 末尾 `buildIndexes()` 之后**（`world.js:321`）
  **和 `deserialize()` 末尾**（`world.js:2390`）——
  `buildIndexes()` 是 `boot()` / `reload()` / `deserialize()` 三条加载路径的**必经点**，
  挂在它后面才能一次覆盖全部三条路。
  > 踩坑记录：第一版**只**挂在 `deserialize()` 上，结果不生效 —— `engine.boot()` 走的是
  > `loadBaseData()` + `loadMods()`，**绕过** `deserialize()`，毒蛇仍是基本拳脚。
- **`spawnNpc` 复制到实例**（`world.js:773`）：`npc.speciesMoves = def.speciesMoves.slice()`，
  `pickSkill` 读的是**实例**字段，必须 copy（`slice()` 避免模板共享引用）。
- **`combat.js:322` `pickSkill` 最前面插入 `speciesMoves` 分支**：过滤出
  `u.learned[id] && world.getSkill(id)` 都成立的，**随机取一招**。
  > 为什么随机：固定取一个等于「只有一招」，观感上与「只有基本拳脚」无异（`B3-3` 就是防这个）。
  > 为什么用新字段而不是占用 `equippedSkills` 空槽：槽位顺序固定，单槽意味着三招只放得出固定一招；
  > 且 `speciesMoves` 与「人物武学」正交，铺到人身上也不串味。

### 两个必须记下来的设计约束

1. **所有动物招式 `type` 一律为「拳」**。最初把 `信子吐信` 设成「暗器」，
   `weaponPenalty`（`WEAPON_REQUIRED` 把剑 / 刀 / 棍 / 鞭 / 暗器标为必须持兵刃）
   就给一条**没手**的蛇打出 `mult 0.45 / acc -25` 和「手中无暗器类兵刃，威力大减」。已全部改为「拳」。
2. **`basic_fist` 保留**（是共存不是替换）—— `B3-2` 专门断言这一点。

### 断言（真打一场统计招式分布）

`B3-3` 让双方打不死（`recalc` 短路成「只保证不死」+ `maxHp = 1e9`）后跑 24 回合，
逐回合统计 `毒蛇使出一招「(.+?)」`。

> 排障记录：毒蛇 110 血、玩家 92 血，一回合就被打死，战斗直接 `finishCombat`，只采到 3 次出招 →
> 「招式有变化」随机翻红。光设 `hp = 1e9` 仍无效，因为 `combat.tickBuffs()` 在 buff 到期时调
> `u.recalc()`，把 `hp/maxHp` 按面板重算回 92。故必须短路 `recalc`。

实测分布：`{毒牙噬咬:25, 缠身绞杀:19, 信子吐信:20}`，无兵刃惩罚，`basic_fist` 仍在。
兵刃惩罚的 grep **必须限定在「毒蛇使出一招…」那一行内** —— 对全部输出 grep 会命中玩家自己的招式。

**变异自证**：`pickSkill` 不读 `speciesMoves` → `193 通过 / 3 失败`（分布退回 `{"基本拳脚":65}`）。

---

## 5 · 批次 2 改动文件清单

| 文件 | 改动 |
|---|---|
| `game/src/core/engine.js` | `TEST_SAVE_PREFIXES` / `TEST_SAVE_IDS` / `_isTestSave()`；`listSaves()` 过滤；`save()` 支持 `{_test}` |
| `game/src/core/bestiary.js` | **新建**：`SPECIES_MOVES` / `SPECIES_RULES` / `speciesOf()` |
| `game/src/core/world.js` | `combatstart` 钩子；`witnessTree()`；`combatStartWitnessReaction()`；`startCombat` 返回 `lines`；`applySpeciesMoves()`（挂 `loadMods` + `deserialize`）；`spawnNpc` 复制 `speciesMoves` |
| `game/src/core/combat.js` | `pickSkill()` 优先 `speciesMoves` 随机取招 |
| `game/src/core/personality.js` | 9 条 `PERSONALITIES` 补 `id` 字段 |
| `game/src/core/commands.js` | `kill` handler 并入目击反应台词 |
| `game/src/renderer/js/start.js` | `continueGame()` 真载入 `local[0]` + 失败兜底 |
| `tools/_test-save-dir.js` | **新建**：测试存档沙盒目录 |
| `tools/smoke-test.js` / `smoke-act2.js` / `smoke-saveload.js` | 存档改写沙盒 + `_test` 标记 |
| `tools/smoke-owner-bugs.js` | 修 2 处假绿 / 弱门槛；新增批次 2 断言（145 → 196） |

> `game/data/*.json` **零改动**（`git diff --stat -- game/data/` 为空）。
> `ui.js` 两份副本本轮未改，`cmp` 确认仍逐字节一致。
> **未执行 git commit。**

## 6 · 批次 2 测试结果

- `tools/smoke-owner-bugs.js`：**196 通过 / 0 失败**（批次 1 为 145，净增 51）
- **23 套全量回归：全部 ok，合计 6792 通过 / 0 失败，红项套：无**
  （22 套既有 + `smoke-owner-bugs`；`smoke-social` 现为 82/0 全绿，旧的「恰好 3 失败」基线已作废）
- **5 组变异测试全部自证有效并 100% 还原**（`diff` 逐字节确认 5 个文件一致）：

| 变异体 | 结果 |
|---|---|
| B7 摘掉 `combatstart` 钩子 | 190 / 5 失败 |
| 摘掉 `PERSONALITIES` 的 `id`（还原死代码） | 191 / 4 失败 |
| B1 关掉 `listSaves()` 过滤 | 190 / 5 失败 |
| B2 退回「只开列表」 | 191 / 5 失败 |
| B3 `pickSkill` 不读 `speciesMoves` | 193 / 3 失败 |

### 本批次的三条方法论教训（都是被变异测试打脸换来的）

1. **静态源码 grep 不能当行为断言**。B2 第一版用 grep `api.load`，变异体插入一行早退后**仍然全绿**。
   必须用 vm 行为测试或真调用路径。
2. **比数字的门槛容易恒真**。`tested > 400` → `tested >= CMD.length` → 最终改为**集合包含关系**。
   数字门槛要用变异测试验证它真的会红。
3. **症状静默失败时要往上游追**。B7 的三层根因（钩子 / 通道 / `id` 字段）说明
   修 bug 时容易只补「让测试变绿」的那一层；第三层最隐蔽 —— 它不报错，
   只是让所有分流变成死代码。

## 7 · 批次 2 遗留

1. **B8（NPC 只会基本拳脚 / 棍法 / 刀法）仍未做**，主人钦定等 NPC 画像。
   本批次的 `bestiary.js` + `applySpeciesMoves()` 就是为它铺的路：
   `speciesOf()` 的第一级识别读的就是**显式 `species` 字段**（`B3-4` 已断言这条路径），
   画像上线后按身份声明 `species` 即可铺开，不碰 NPC 战斗数据。
2. **B5 触屏实机验仍未做**（批次 1 遗留的前置条件，见 §1.4）。
3. **B6 的 7 条多词 cmd 缺 `effects`** —— 内容缺口，仍建议单开一批补数据，不要记成 bug 修复。
4. `saves/test_slot.json` 这个历史遗留文件**仍在盘上**（只是不再被列出）。
   删它属于破坏性操作，等主人拍板。
---
---

# 批次 2 · 返工（BLK-1 / BLK-2 / 三处假绿）

> 返工时间：2026-10-10
> 触发：`design/14-batch1-acceptance.md` §9 判定批次 2 为 **CONCERNS**，两条阻塞项。
> 本次全部结论**自己跑代码复现**，不采信验收报告的措辞；两条阻塞项均已独立复现后才动手。
> 纪律：`game/data/*.json` 零改动、不 git commit、26 套全量回归为判据。

## 0 · 返工前先独立复现（两条阻塞项都复现了才动手）

| 项 | 复现方式 | 实测结果 |
|---|---|---|
| **BLK-2** | `boot().newGame()` 后遍历全仓 333 个 NPC 模板调 `speciesOf` | `miao_lan`（蓝凤凰，`tag:swordsman`）→ `snake`，挂上 `snake_fang/snake_coil/snake_spit` |
| **BLK-1** | 固定 seed 走 `onRoomEnter(p, getRoom('jiangnan_east_road'))` | 返回**仅 1 行**「【遭遇】山贼拦住去路！」，目击者台词 0 行 |

BLK-2 实测命中范围（修复前）：`snake` 判给了 `["miao_lan","mob_snake"]` —— 333 个模板里**多出一个人类**。

---

## 1 · BLK-2 · `speciesOf()` 把人类 NPC 误判成蛇类

### 1.1 根因

旧 `SPECIES_RULES` 的第③级是**关键词兜底**：拿 `/蛇|snake|viper/i` 去扫 `name + desc`。
中文武侠语料里这条规则**没有判别力** —— 人物可以随手写到任何动物：

| NPC | 是什么 | 命中原因 |
|---|---|---|
| `miao_lan` 蓝凤凰 | **人**（苗女剑客 `tag:swordsman`） | desc 写「手腕上盘着一条碧绿小蛇」 |
| `npc_snake_blade` 蛇婆婆 | **人** | id 与名都含「蛇」 |
| `npc_jinse` 金蛇郎君 | **人** | 名含「蛇」 |

后果（实测）：她整局只出 `{毒牙噬咬:31, 信子吐信:24, 缠身绞杀:18}`，
自己的苗家暗器 `miao_gu` 与冰蚕丝掌 `ice_silk_zhang` 虽在槽位里但**永不被取用**。
又因B3 是运行时注入，**每局、每个读档后都复现**。

### 1.2 修法：采纳验收建议的第 2 条 —— **全面转显式声明，删掉关键词兜底**

（验收 §9.9-2 亦倾向这条。B8 铺 300 个 NPC 画像时本就要逐个写 `species`，顺手写最可靠、可审计。）

判别层从三级收缩成两级，都**不猜**：

| 级 | 判据 | 说明 |
|---|---|---|
| ① | 模板显式 `def.species` | B8 画像系统的正式入口 |
| ② | **锚定 id 规则表** + `isAnimalId` 类型闸门 | 每条规则是显式 id 清单，不是关键词面 |
| ~~③~~ | ~~名称/描述关键词兜底~~ | **已删除** = BLK-2 根因 |

**关键设计判断：漏 vs 误的取舍。**
关键词兜底只能二选一，而两种错法的代价完全不对称：

- **误判**（人→动物）：玩家可见的严重回归，**新引入**的；
- **漏判**（动物判不出）：静默退回原来的「基本拳脚」，即**批次 2 之前的常态**，不是新问题。

所以宁可漏不可误 —— 这条判断直接决定了「删兜底、宁可漏判」而不是「换个更宽的关键词」。

**第二道保险（防复发）**：`applySpeciesMoves()` 里加类型闸门
`if (!bestiary.isAnimalId(id)) { this._speciesHumanRejects++; continue; }`
—— 只有 `mob_`/`animal_` 前缀模板才允许注入。即便将来判别层又出岔子、哪怕有人手滑给人物写了
`species` 字段，人物也拿不到 `speciesMoves`（`BLK-2 守卫6` 断言这条，且断言闸门**确实拦下了东西**，
不是恒真）。

> 批改规则表时**必须写 `^mob_snake$` 这样的锚定式**。把无锚定的 `/snake/i` 加回来就会命中
> `npc_snake_blade`，正是原错。`BLK-2 守卫7` 断言「全部规则：仅锚定 ids、无关键词 re」来钉死这条。

### 1.3 顺手修掉的两处判别缺口

1. **`mob_black_bear`（黑熊）漏判** —— 规则表原先只列 `wolf|tiger|boar|leopard`，黑熊判不出物种、
   原地复发 B3（只会基本拳脚）。已补进 beast 规则。
   （验收举的 `丹顶鹤`/`巨鼠` 实测**不在当前数据里**，是举例；所以改用更强的判据，见 §1.4 守卫7。）
2. **`beast` 只有 1 招**（蛇有 3 招）—— 「只有一招」在观感上与原 bug 无异，属同型问题。
   已补 `利爪撕扯 beast_rend` / `咆哮威吓 beast_roar`，猛兽类招式补到 3 招，与蛇类持平。

### 1.4 断言：从「手挑一个样本」改成**全量遍历守卫**（验收明确要求）

原 `B3-4 非动物 NPC 判不出物种` 只测了 `speciesOf({id:'guard_palace'…})` **一个手挑样本**，
而那个样本恰好不含任何物种关键词 —— 所以蓝凤凰这类误判它一条都拦不住。

新增 `BLK-2` 组共 **20 条**，核心是 7 道守卫（模板总数 333 / 人物 323 / 动物 10）：

| 守卫 | 判据 |
|---|---|
| 1 | **全部 323 个人物模板一律不带 `speciesMoves`** ← 防 BLK-2 复发的通用闸门 |
| 2 | 全部人物模板不带 `species` 字段 |
| 3 | 全部人物模板的 `learned` 里没混进任何物种招式（6 种全扫） |
| 4 | 蓝凤凰本体：`speciesOf===null` + `desc` **确实含「蛇」字**（证明上一条不是因样本无关键词而绿）+ 实例槽位仍是 `miao_gu`/`ice_silk_zhang` |
| 5 | **真打 40 回合**统计蓝凤凰实际出招，不得出现任何蛇类招式，且能出自己的武学 |
| 6 | 类型闸门有效：给人物硬写 `species='snake'` 后 `applySpeciesMoves` 拒绝注入，**且闸门触发计数 ≥1** |
| 7 | 判不出物种的 `mob_` 模板**恰好等于**已知人物白名单（新增动物漏规则会红）；白名单项须确实是人；规则表全为锚定式 |

守卫 5 是关键：静态字段全绿但战斗里仍出蛇招，是「注入点漏了一处」的典型形态，所以必须真打一遍。

**修复后实测**：`snake` 判给 `["mob_snake"]`（唯一）、`beast` 判给
`["mob_wolf","mob_boar","mob_black_bear","mob_tiger"]`，人物 0 个被污染。

---

## 2 · BLK-1 · 遭遇战路径仍不显示目击者台词

### 2.1 根因

主人原话是「看到我被山贼与毒蛇**袭击**」—— 关键词是**袭击**：玩家**根本没出手**，
走的是 `world.onRoomEnter` 的遭遇分支，**不是** `exec('kill …')`。
批次 2 只修了kill 路径（`commands.js` 老实接了 `r.lines`），而遭遇路径
`world.js:1622` 写的是 `this.startCombat(ch, npc);` —— **丢弃返回体**，
而台词正装在返回体的 `lines` 里。

后果：**行为对、观感等于没反应** —— 怯懦者确实默默逃走（房间都变了），
但屏幕上**一行台词都没有**。与 B5「行为对但玩家看不见」是同型问题。

### 2.2 修法

```js
const r = this.startCombat(ch, npc);
if (r && Array.isArray(r.lines) && r.lines.length) lines.push(...r.lines);
```

修复后玩家实际看到 3 行：`【遭遇】山贼拦住去路！` + `苏明吓得魂飞魄散，连滚带爬地逃走了。` + 侠义者拔刀台词。

### 2.3 断言：覆盖玩家未出手的路径，且必须能防恒真

新增 `BLK-1` 组 **10 条**，走真实 `onRoomEnter` 路径（不走 `kill`）。

**刻意不复用kill 路径的写法**：`kill` 自带「你向山贼发起了攻击！」等固有输出，
那种门槛在遭遇路径上会被唯一那行「【遭遇】…」天然满足。所以断言的是
**具体目击者台词文本**出现在返回里，并做**差分**：

| 断言 | 判据 |
|---|---|
| 核心 | 返回 ≥2 行且含怯懦者**名字**（BLK-1 的核心判据） |
| 分项 | 怯懦者「名字 + 逃」、侠义者名字，各自在输出里 |
| 行为回归护栏 | 遭遇战里怯懦者依然真的换房间（证明修台词没把行为改坏） |
| **差分反证** | **同样遭遇但无目击者 → 输出不含任何台词** |
| 对照组有效性 | 无目击者时「【遭遇】」提示仍在（证明场景真跑了，不是场景没触发） |

差分反证是防「断言恒真」的关键：若台词在无目击者时依然出现，说明那些字不是目击者反应。

> 固定随机（`rng.chance=()=>true`）不是「把断言写死成恒真」：遭遇池与目击者都是真实数据，
> 只是不让随机数决定本组跑不跑，否则这条断言会 flaky（时绿时红）。

---

## 3 · 清掉三处已查实的假绿（另自查出第四处）

| 编号 | 原写法 | 问题 | 改法 |
|---|---|---|---|
| **FG-1**（中危） | `B7-2: r.lines.length > 1 && txt.length > 0` | 后半段恒真；前半段被 `kill` **固有输出**天然满足 → **目击反应没发生也可能全绿** | 拆成 4 条差分断言：分别断言怯懦者台词（含「逃」）、侠义者台词、**两句分属不同人**、不误伤玩家自己的攻击行 |
| **FG-2**（低危） | `B1-0: ok(..., true, ...)` | 谓词是**字面量 `true`**，恒真 | 改成真断言：**自造测试档并断言它真落到了盘上**，且**不被** `listSaves` 列出 —— 把「过滤真的在跑」的前提钉死 |
| **FG-3**（低危） | `if (onDisk.length) {…} else { ok(..., true, 'skipped') }` | 磁盘无真档时**静默跳过仍计通过**，依赖玩家目录偶然状态 | 改为**在沙盒 `mkdtemp` 目录里自己造 3 档真档**，前提恒成立 |
| **FG-4**（自查·中危） | `B5-10: probes = Object.keys(CMD).slice(); … ok(missing.length === 0)` | **结构上恒真** —— probes 本就是从 CMD 的键**复制**出来的，再问「CMD 的键有没有不在 probes 里」永远是没有。自称「动态自证」，实际连自证都算不上 | 改成 3 条：① 从 probes 侧算覆盖 CMD 全表；② 额外探针（方向键/自然语言）数量 > 0，防止 probes 退化成 CMD 副本；③ **反向自证**：构造一个真缺项的假探针表，检查必须报警 |

FG-4 尤其值得记：它是「前任改成集合包含关系」那次修订里**藏着的结构恒真**，
验收 §9.8.4 把 B5-10 列为待抽查项，本批一并复验并修掉。

**FG-3 顺带修掉一个更隐蔽的问题**：`savedAt` 是**数字**（`Date.now()` 毫秒），不是 ISO 字符串。
我第一版把它写成 ISO 串，`(b.savedAt)-(a.savedAt)` 直接 `NaN`，`sort` **静默退化成不排序**，
首行判据等于白测。现已加断言「三档 `savedAt` 是可比数字且刻意递增（排序判据成立）」把前提钉死。

### 3.1 我自己新写的断言里也踩了三个坑（自查记录）

诚实记录，因为都是**新代码**里的假绿/错误前提：

| 坑 | 现象 | 修正 |
|---|---|---|
| **FG-4 同型** | 我给 B5-10 反向自证写成 `canaryOK ? missing : []` —— missing 恒为空，**等于又给自己开了一道恒真闸门** | 改为**真的构造一个缺项的探针表**跑同一判据 |
| **FG-1 同型** | 我加了「输出里不许提到凶手名字」，结果**必然红** —— `kill` 自身固有输出就是「你向山贼发起了攻击！」。前提错了，不是代码坏了 | 删掉；「凶手不在反应名单」由既有 `B7-7` 按反应专属句式筛，不误伤 |
| **守卫 7 前提错** | 我写「所有 `mob_` 前缀都判得出物种」，把 5 个**人**（山贼/山贼首领/魔教教众/巡城兵丁/黑衣人）判成漏判 | 改为**白名单相等**判据：判不出物种的 `mob_` 必须**恰好**等于那批已知人物（新增动物漏规则会红），且白名单项须确实是人 |

---

## 4 · 变异测试自证

新增 `tools/mutate.js`（变异施加器），把「变异必须真施加」和「还原必须逐字节」**写进代码**：
施加后立刻 `grep` marker 校验、施加前 `.mutbak` 备份、还原后 `cmp` 逐字节比对，
任一步不符**直接抛错退出**。这直接针对验收 §9.5 记录的「验收机 bash 无 `perl`、变异静默未生效」坑。

### 4.1 四组变异全部真变红

| # | 变异 | 缺陷是否复现 | 断言结果 |
|---|---|---|---|
| 1 | 摘掉 `PERSONALITIES` 的 `qienuo.id` | 是 | **6 条红**（B7-3×2、FG-1/B7-2、B7-性格、BLK-1×2） |
| 2 | `speciesOf()` 退回关键词兜底 | 是（蓝凤凰→`snake`） | **2 条红** → 233/2 |
| 2b | 兜底 **+** 类型闸门一起拆（= 完整还原 BLK-2 现场） | 是（挂上三招蛇类） | **9 条红** → 226/9 |
| 3 | 遭遇战路径丢弃返回体 | 是（台词消失，输出仅 1 行） | **3 条红** → 232/3 |

变异 2b 最有说服力 —— 守卫 5（真打 40 回合）实测输出：
`实出招: 使出一招缠身绞杀,使出一招毒牙噬咬,使出一招信子吐信`，
证明这条断言真的打在**玩家可见的行为**上，不是查字段。

### 4.2 两次「变异没真复现缺陷」的记录（比假绿更危险）

变异施加成功（grep 得到标记）≠ 变异复现了缺陷。这两处如果收工，会得出**完全错误**的结论：

| 次数 | 现象 | 后果 |
|---|---|---|
| 变异 2 第一版 | 兜底行插在**类型闸门之后**，而闸门在前面就把人物挡了 → 蓝凤凰仍判不出蛇类，断言**照样全绿 235/0** | 若收工，会写成「BLK-2 修好了但断言测不出来」，进而**放弃一条其实有效的断言** |
| 变异 2b 第一版 | 只拆闸门、不加兜底 —— 锚定规则本来匹配不到 `miao_lan`，拆了也没用，**全绿 235/0** | 若收工，会把它当成「第二道保险有效」的证据 —— 实际只证明了「闸门拆了也没用」，没证明「闸门拦得住东西」 |

修正办法：**每次施加后都要额外验证「缺陷真的复现了」**（跑一段脚本确认行为已变回缺陷态），
不能只验证「代码真的改了」。变异 2b 也因此改成「兜底 + 拆闸门」双点，才构成有效对照。

### 4.3 还原校验（100%）

| 校验项 | 结果 |
|---|---|
| `bestiary.js` / `world.js` / `personality.js` | `cmp` **逐字节一致**，且 md5 与施加前完全相同 |
| `node tools/mutate.js check` | 无 `.mutbak` 残留 |
| 还原后 `smoke-owner-bugs.js` | **235 通过 / 0 失败** |
| `git diff --stat -- game/data/` | **为空**（数据零改动） |
| `game/src/renderer/js/ui.js` vs `server/public/js/ui.js` | 逐字节一致 |
| 玩家 `saves/` | 回归后零变化 |

---

## 5 · 批次 2 返工 · 测试结果

```
26 套 smoke 全 exit=0、✘ 计数全 0
owner-bugs 235/0（返工前 196/0，+39 条：BLK-1 组 10 + BLK-2 组 20 + 假绿替换与新增 9）
```

| 套件 | 结果 | 套件 | 结果 |
|---|---|---|---|
| owner-bugs | **235 / 0** | mainline | 47 / 0 |
| tutorial | 44 / 0 | kidnap | 51 / 0 |
| ux-fixes | 43 / 0 | estate | 48 / 0 |
| rumor | 32 / 0 | guards | 32 / 0 |
| sect | 21 / 0 | 其余 16 套 | exit=0、✘=0 |

**判据：26 套（不是旧基线的 23 套；`ls tools/smoke-*.js` 实数为 26）。**

---

## 6 · 批次 2 返工 · 改动文件清单

| 文件 | 改动 |
|---|---|
| `game/src/core/bestiary.js` | 删关键词兜底；`SPECIES_RULES` 改锚定 id 清单；新增 `isAnimalId`/`ANIMAL_ID_PREFIX`；`beast` 招式 1→3 招 |
| `game/src/core/world.js` | 遭遇战接住 `startCombat` 返回体并推进 `lines`（BLK-1）；`applySpeciesMoves` 加人物类型闸门 + `_speciesHumanRejects` |
| `tools/smoke-owner-bugs.js` | 清 FG-1/FG-2/FG-3 + 自查 FG-4；新增 `BLK-1` 组 10 条、`BLK-2` 组 20 条 |
| `tools/mutate.js` | **新建**：变异施加器（施加校验 / 逐字节还原 / 残留检查） |

未改：`game/data/*.json`（零改动）、`combat.js`（`pickSkill` 逻辑不动）、前端两份 `ui.js`。

---

## 7 · 批次 2 返工 · 遗留

1. **B8（NPC 只会基本拳脚）仍未做**，主人钦定等 NPC 画像。
   判别层已转显式声明，铺开时给模板写 `species` 即可；**判别层需要随画像同步扩充**
   （当前只有 snake/beast 两类，新增物种要在 `SPECIES_RULES` 加锚定 id 并补招式表）。
2. **B5 触屏实机验仍未完成** —— 保留待办，本报告不予追认。
3. **B7 的官差不参与性格分流**（`witnessTree` 里 `official` 分支排在性格判断之前）——
   验收 §9.3.5 记录的设计观察，本批**未改**（不阻塞批次 2）。
   建议批 3 明确取舍：若有意则在注释写明，若疏漏则把性格判断提前。
4. `saves/test_slot.json` 历史遗留档仍在盘上（不再被列出），删除属破坏性操作，等主人拍板。

---

# 批次 4 · B10 / B11 / B12

> 主人第 2 轮反馈。本批**新增** 3 条修复 + 新建独立回归 `tools/smoke-batch4.js`（26 条）。
> 硬纪律：每条先复现、断言打在真 `exec` 路径、变异自证、`game/data/*.json` 零改动、不 commit。

## 0 · 摘要

| # | 问题 | 根因（一句话） | 修法 | 测试 |
|---|---|---|---|---|
| B10 | 点 NPC/野兽菜单没有「攻击」 | `lookRoom` 的 `hl.actions` 里压根没注册攻击动作 | 加「攻击」，cmd 走**真实** `attack`（批次2 已并入 kill）；敌对者置顶、寻常者置底 | `smoke-batch4` B10-1~8 |
| B11 | 毒蛇被叫「他」 | 全仓几十处**硬编码**「他」/`female?'女':'男'`，各自兜底，`gender='other'` 一律落进「他/男」 | 新增 `pronouns.js` **单一入口** `pronounOf()`/`genderNoun()`，逐条改渲染点 | `smoke-batch4` B11-1~11 |
| B12 | 击败后再回去毒蛇「x2」 | 遭遇分支**每次进屋独立刷怪、从不查房里是否已有同种** → 打输后毒蛇没死，再进屋又刷一条**活**蛇 | 同种活体**复用**（re-engage），不再叠实例 | `smoke-batch4` B12-1~6 |

---

## 1 · B10 · 菜单里没有「攻击」

**复现/现勘**：`game/src/core/commands.js` `lookRoom()` 构建 `hl[].actions` 时，
只 push 了 `看看/交谈/询问/请教武学/看看货物/接任务/送东西/查看关系`，
**没有任何攻击类动作** —— 主人点的就是这份菜单。攻击指令本身存在
（`reg(['kill','fight','attack','杀','攻击','打'], …)`，批次2 已把 `attack` 并入 `kill`）。

**修法**：
```js
const pron = pronounOf(one);                 // B11 同源
const inBattle = !!(w.battle && w.battle.target === one);
const hot = !!(one && (one.hostile || one.inCombat || inBattle));
const attackAct = { label: '攻击', cmd: 'attack ' + k };   // ← 真实攻击指令
if (hot) actions.unshift(attackAct); else actions.push(attackAct);
```
- cmd 用**裸名 k**（与既有 `look k`/`talk k` 同一口径，`fuzzyFind` 认），不另起一套。
- **前端零改动**：`ui.js` 的 `openInteractMenu` 通用地把 `hl.actions` 渲染成菜单 →
  仅后端加一项即可。两份 `ui.js` 仍逐字节一致（已 `cmp` 验证）。

**「普通百姓要不要给攻击」的决定：给，但排最后。理由**：
1. **武侠世界本就能动手**，后端从不拦「攻击谁」（`startCombat` 无身份门槛）。
   主人报的就是「菜单里**没有**这个选项」——把入口藏起来才是病根，不是安全屏障。
2. **误触代价可控**：普通百姓的「攻击」压在「查看关系」之后，不与「交谈」相邻，
   触屏滑点概率更低；且攻击有显式文案「你向 X 发起了攻击！」，开打后可 `flee` 脱身。
3. ⚠️ **铁律 33**：`hostile` 只用于**排序**（敌对者置顶），**绝不当排除条件**。
   它是模板常驻标记（山贼/野兽一出生 true、打输也不清），若拿来当「不给攻击」的判据，
   会掐死「打倒敌人装走」这类玩法。B10-6 专门测「hostile=false 时攻击入口仍在」。

**测试**（`tools/smoke-batch4.js`）：B10-1 毒蛇菜单出现攻击 / B10-2 cmd=`attack 毒蛇` /
B10-3 敌对者置顶 / B10-4 寻常 NPC 也有 / B10-5 寻常 NPC 置底 / B10-6 铁律33 /
**B10-7 真 `exec('attack 毒蛇')` 真开打** / B10-8 输出含「发起了攻击」。
**变异自证**：摘掉「push 攻击」→ B10-1~6 全红（24→20 通过）。

---

## 2 · B11 · 毒蛇被叫「他」

**根因**：不是一处写错，而是**全仓几十处硬编码「他」**、性别名词一律
`gender === 'female' ? '女' : '男'`（`other` 落进 else）。毒蛇 `gender='other'`
→ 被叫「他」、在 `favor` 详情里被叫「男」。

**修法：收敛成单一入口 `game/src/core/pronouns.js`**：
- `pronounOf(x)`：`female→她` / `male→他` / 其余（`other`/缺失）→ 兽类「它」、其余「他」。
- `genderNoun(x)`：`male→男` / `female→女` / 其余「不明」。
- 「是不是兽」用 `bestiary.speciesOf` 的**显式 id 清单**（与 B3/B8 同一份真相源），不猜关键词。

**⚠️ 关键作废「other 一律当它」的简单版**：数据里 `gender='other'` 有 **6 个** ——
5 个是兽，第 6 个是 **`mob_assassin` 黑衣人**，他是**人**（刺客，只是「全身笼罩在黑衣中」
性别成谜）。把 `other` 一刀切当「它」，毒蛇修好了，黑衣人改被叫「它」——**新造的语病**。
所以判据分两层：先看 male/female，其余再看**是不是兽**。B11-5/B11-9 专测这条。

**实现踩坑（已修）**：`isAnimal` 最初写 `const def = x.def || x`，但 NPC 模板/实例上
`def` 也可能是**防御值（数字）**（`templates.def=5`），于是 `pronounOf(模板)` 误判成「他」。
改为 `x.def` 是对象时才当模板用（B11-8 抓到并回归）。

### B11 · 全局「他/她/男/女」清单与处置

> 命中口径：`grep -c "他\|她" game/src/core/*.js`（**含注释**）。

| 命中处 | 性质 | 处置 | 理由 |
|---|---|---|---|
| `commands.js` 303 `接他/她的任务`、304 `送他东西` | 菜单文案 | **改**（走 `pronounOf(one)`） | 兽也会进这份菜单 |
| `commands.js` 474 `人称他`、530 `他习有：`、570/571 `看不透他的火候/他究竟练到哪一步` | 第三人称渲染 | **改** | 直指被看的 NPC（可能是兽） |
| `commands.js` 905 `合他心意/不对他胃口`、1020 `他孤身一人`、1072 `若他肯收`、1677 `多与他来往`、1977 `他说完`、1989 `这人…找他…`、3175 `他怀里` | 第三人称渲染 | **改** | 礼品/关系/请教/打听/随身物，均指被操作的那个 NPC |
| `commands.js` 640 `{male,female,other}[p.gender]` | 玩家性别名词（**本来就是正确范式**） | **改**（改走 `genderNoun(p)`） | 输出不变；仅为「单一入口」一致化 |
| `commands.js` 3137 `favorDetail` 性别、婚配候选列表 `c/sp/x.gender?'女':'男'`（共 8 处） | 性别名词 | **改**（走 `genderNoun`） | `other` 原本冒充「男」 |
| `social.js` 262 `他怕是看不上眼`、307 `原来他素来喜爱`、429 `他怀里的钱`、437 `被他攥住手腕` | 第三人称渲染 | **改** | 送礼 / 偷窃目标可能是兽 |
| `marriage.js` 132 `gCN(g)=female?'女':'男'` | 性别名词助手 | **改**（委托 `genderNoun`） | 同型缺陷，顺手归一化（婚配语境 `other` 不可达，但口径要统一） |
| `commands.js` 514/547/568/954/969/1027/1028/1038/1681/3189/3217、`social.js` 281 | **注释** | **保留** | 不是玩家可见文本 |
| `commands.js` 943 `（他压低了声音）` | 通话人台词 | **保留** | 说话者来自「打听传闻」的在场者，`roomNpcs` 已滤掉 `hostile/knockedOut/dead` → 必为人；且「他」泛指传话人 |
| `commands.js` 1014/1048/1111/1172 | **用法提示串**（guanxi/qingjiao/qiecuo/请客） | **保留** | 「他」指**你将要输入的那个人**（泛指引数），非屏幕上某只兽；改了反而怪（「查看它与别人的关系」） |
| `commands.js` 1461 `p.gender==='female'` | **逻辑判定** | **保留** | 女子卖身提示的条件，不是人称渲染 |
| `kidnap.js`(26) / `kinship.js`(10) / `marriage.js`(3) / `estate.js`(3) / `world.js`(16) / `engine.js`(5) / `combat.js`(1) / `tutorial.js`(2) / `bestiary.js`(2) | 绝大部分是**注释**；另有少量**只作用于人**的系统（掳人/结拜/婚嫁/家园/家丁）与**泛指路人**（目击者、债主、家丁） | **保留** | 这些系统**兽类进不来**（掳人/婚配/结拜有明确的人物门槛），且「他」多为泛指，替换不会修好任何玩家可见问题，反而扩大改动面 |

**测试**：B11-1~3 毒蛇用「它」/不再「他习有」/看不透提示用「它」；B11-4 女 NPC 用「她」；
**B11-5 黑衣人（other 的人）用「他」不叫「它」**；B11-6~10 入口函数矩阵（含边界）；
B11-11 毒蛇 `favor` 详情性别显示「不明」（旧实现显示「男」）。
**变异自证**：`pronounOf` 强制返回「他」→ B11-1/2/3/8 全红。

---

## 3 · B12 · 被毒蛇击败后再回去，毒蛇「x2」

### 先复现（**不许凭推断改**）
复现脚本（真 `GameEngine.boot()` + 固定 seed + 一条「含毒蛇的遭遇房 + 无遭遇邻居」）：
1. 把遭遇房 `encounter.chance=1`、`npcs=['mob_snake']`（**内存态**，不动 json）；
2. `go 遭遇房` → 刷 1 条毒蛇、开打；
3. **被毒蛇击败**：`p.hp=0` → `auto` → 走真实 `playerDeath` → 复活回客栈（`movePlayerTo`）；
4. 再 `go 遭遇房`（回房）。

**实测（修复前）**：每循环一次「活着的」毒蛇 +1 —— `alive = 1, 2, 3, 4, 5`，
房间描述出现 `毒蛇（山中猛兽） x4`。**复现成功。**

### 结论：**重复 spawn**（不是「倒地实例没清」）
- 遭遇分支（`world.onRoomEnter`）**每次进屋独立掷骰刷怪，从不检查房里是否已有同种**。
- 平时见不到 x2，是因为打赢后毒蛇被 `onNpcKilled` **删掉**了；一旦**打输**，毒蛇没死、
  留在原地，玩家复活回客栈再进来 → **又刷一条活的** → 两条**活**毒蛇 → 显示 x2。
- 「倒地实例没清」**不成立**：倒地实例是 `knockedOut+dead`，被 `npcsIn` 过滤，
  **根本不参与 `x2` 计数**（`cls` 统计的是 `npcsIncludingTemplates` → 走 `npcsIn`，只数活体）。

### 修法：同种活体**复用**（re-engage），不删实例、不叠实例
```js
const existing = this.npcsIn(ch.room).find(n => n.defId === nid) || null;
const npc = existing || this.spawnNpc(nid, ch.room, 1);   // 已有活体就复用它再打一场
```
**为什么是「复用」而不是「已有就不刷」或「删倒地实例」**：
- **不刷** 会让「被击败后回屋」**毫无动静**（本该再被拦路），观感与原设计不符；
  且会破坏既有 `BLK-1` 测试（它刻意连调两次 `onRoomEnter`，期望有一次遭遇）。
  复用两者兼得：**既不叠同名，又不丢这次遭遇**（拿原实例再 `startCombat`）。
- **不删实例**：倒地/晕厥是玩法的一部分（补刀 / 搜身 / 装袋全靠 `world.downedIn`）。
  复用判据用 `npcsIn`（**过滤 dead**）→ 地上躺一条时，再进屋**照常**刷一条活的，
  倒地实例**原样保留、不被删**（B12-4~6 专测）。
- 只限「**同种**不叠加」，换个物种照刷（不消灭遭遇本身）。
- `game/data/*.json` 零改动（运行期状态比对）。

**测试**（`tools/smoke-batch4.js`）：B12-1 反复进出活体数恒为 1（`perEntry=[1,1,1]`）/
**B12-2 房间描述无「毒蛇… xN」叠加** / B12-3 回房后活体数 1 / B12-4~6 倒地实例保留可搜身。
**变异自证**：令 `existing=null`（退回重复 spawn）→ `perEntry=[1,2,3]`、`毒蛇（山中猛兽） x4`
→ **B12-1 / B12-2 / B12-3 全红**。

---

## 4 · 批次 4 · 改动文件清单

| 文件 | 改动 |
|---|---|
| `game/src/core/pronouns.js` | **新建**：B11 单一入口 `pronounOf()` / `genderNoun()` / `isAnimal()`（兽类判据复用 `bestiary.speciesOf` 显式清单） |
| `game/src/core/commands.js` | B10：`hl.actions` 加「攻击」（真实 `attack`，敌对置顶/寻常置底）；B11：23 处人称/性别渲染改走单一入口 |
| `game/src/core/social.js` | B11：送礼/偷窃 4 处「他」改走 `pronounOf` |
| `game/src/core/marriage.js` | B11：`gCN()` 委托 `genderNoun`（other 不再冒充「男」） |
| `game/src/core/world.js` | B12：`onRoomEnter` 遭遇分支——同种活体**复用**，不再重复 spawn |
| `tools/smoke-batch4.js` | **新建**：B10/B11/B12 独立回归 26 条（真 `exec` / 复现路径 / 变异自证） |

**未改**：`game/data/*.json`（`git diff --stat -- game/data/` 为空）、
前端两份 `ui.js`（`cmp` 逐字节一致）、`tools/smoke-owner-bugs.js`（他人在改，未触碰）。

---

## 5 · 批次 4 · 测试结果

```
28 套 smoke 全 exit=0、✘ 计数全 0
tools/smoke-batch4.js  26 / 0   （本批新建）
tools/smoke-owner-bugs.js 235 / 0（未改动，回归保持）
（其余 26 套维持各自基线；`ls tools/smoke-*.js` 实数 28，含他人在改的 smoke-b9-intro.js）
```

**变异自证（三处都先确认缺陷复现，再判红绿）**：
- 去重关掉 → B12-1/2/3 红（复现 `毒蛇 x4`）；
- `pronounOf` 恒返回「他」→ B11-1/2/3/8 红；
- 攻击动作摘除 → B10-1~6 红。

---

## 6 · 批次 4 · 遗留

1. **B8 仍未做**（主人钦定等 NPC 画像）；`pronouns.isAnimal` 走的是 `bestiary.speciesOf`
   显式清单，B8 铺开新物种时**要同步在 `SPECIES_RULES` 加锚定 id**，否则新兽会被叫「他」。
2. B10 的「攻击」对**所有人**开放（排位不同）。若主人希望「寻常百姓不给」，改成
   `if (hot) unshift(攻击)` + 其余不 push 即可（一行），本批按「能动手」的世界观选择全给。
3. B12 修的是「同种叠加」；**不同物种**在同一遭遇房仍会各自累积（如山贼+毒蛇）。
   主人本次未报此现象，**未扩大改动**；如需再议。
---

# 批次 5 · B14 · 手机端地图 UI（地块名看不全 + 手滑动划不动）

> 主人原话（2026-10-10）：
> 「手机端输入「地图」打开后 ui 很麻烦，**地图地块名看不全**，**手滑动地图划不动**，很麻烦」

## 0 · 摘要

| 子问题 | 根因（文件:段） | 修法 | 桌面观感 |
|---|---|---|---|
| 地块名看不全 | `ui.js·mapHtml`：`MAP_NODE=26`＋`.mn-name{font-size:8px}` 是给桌面定的；手机高 DPI 下 8px 几乎不可读，且 `shortName` 一刀砍到 **4 字**（"回春堂后院"→"回春堂后"），触屏又没有 hover，`title` 提示看不到 | 屏幕自适应两套尺寸 + 名字上限 4→6 + 点方块弹完整名兜底 | **零改动**（≥640 仍走 30/26/8/4 字） |
| 手滑动划不动 | `ui.js·bindMapPan`：`down/move` 直接读 `e.clientX`，而 **TouchEvent 没有 clientX**（坐标只在 `e.touches[0]`）→ `dx=NaN` → `el.scrollLeft=NaN`（浏览器忽略） | 统一取坐标入口 `ptOf()`（鼠标→clientX，触摸→touches[0]） | **零改动**（鼠标路径行为不变） |

一句话：**两个 bug 都是"桌面能过、手机不行"的同一类**——一个把桌面尺寸当成了唯一尺寸，一个把鼠标事件当成了唯一事件。

---

## 1 · B14-a · 地块名看不全

### 1.1 根因（先定位，不凭推断改）

`game/src/renderer/js/ui.js`（两份副本之一）的 `mapHtml()`：

- 常量写死 `MAP_CELL=30 / MAP_NODE=26 / MAP_PAD=34`（原 1489-1491 行）；
- 房间名 `shortName(r.name)` **硬砍 4 字**（原 1691 行）；
- `.map-node .mn-name { font-size: 8px }`（`css/main.css`）。

后果：26px 方块 + 8px 字，在手机上（devicePixelRatio 2~3）实际渲染出来极小、几乎不可读；
名字被砍到 4 字丢掉后半截；触屏没有 hover，方块上的 `title="完整名"` 提示**根本看不到**。
三层叠加 = 主人说的"地块名看不全"。

> ⚠️ 这里**没有**改 `.map-node` 的 CSS 常量、**没有**动 `maplayout.js` 的坐标算法——
> 坐标算法本身是对的（`map-check` 6278 项断言全绿），问题只在"画多大、显示几个字"。

### 1.2 修法（尺寸自适应 + 名字放宽 + 点击兜底）

1. **屏幕自适应两套尺寸**（`mapHtml` 顶部按 `global.innerWidth` 选）：
   - 宽屏（≥640）：`cell30 / node26 / pad34 / font8 / 名字上限4` —— **与原来逐字节相同**；
   - 窄屏（<640）：`cell52 / node46 / pad30 / font13 / 名字上限6`。
2. 方块尺寸/名字字号全部**行内落到渲染结果里**（`width/height/font-size/line-height`）——
   这样尺寸是"渲染出来的事实"，测试能真读，不靠静态 grep CSS。
3. `shortName(n, max)` 增加可选上限：窄屏 6 字（46px 方块两行 3+3 放得下），不传仍 4 字（老行为）。
4. **点方块弹完整名**：给"看得到但走不到"的格子绑 `onclick` → `toast` 完整房间名 + 区域 + 步数；
   未探索的只提示"此处尚未探索"，**不剧透名字**。

### 1.3 为什么选这条路线（备选与理由）

| 备选 | 评估 | 取舍 |
|---|---|---|
| 只给更短的显示名 | 26px 方块缩字只会更小，且本就砍到 4 字 | ✗ |
| 只做点击弹名 | 治标；方块里仍是 8px 看不清 | 作为**补充**保留 |
| 缩放（zoom/transform） | 字会跟着变小或糊，且点击热区错位 | ✗ |
| **放大格子 + 放宽名字 + 点弹名** | 字真的变大变全，配合修好的平移可看全区 | ✓ **采纳** |
| 只显示当前区域重点房间 | 主人要"看地图"，砍信息反而更差 | ✗（区域/全图切换已存在） |

**桌面端观感是否被改坏**：否。≥640 时 `NARROW=false`，`cell/node/pad/font/名字上限`
四项与旧值**逐一相等**，几何步长、字号、4 字上限全部不变（`smoke-mapui` 的 A-9~A-14 专钉这一点）。

> 顺带修了一处**抽取环境**下的隐患：`mapHtml` 里读写模块级 `mapScope` 时对 `typeof` 兜底，
> 让"被单独抽出去跑"的测试脚本（e2e / map-snapshot）不再抛 `mapScope is not defined`。
> 副产品：`tools/e2e.js` 由 **120/2 → 122/0**（2 处历史红是同一个 `mapScope` 根因）。

---

## 2 · B14-b · 手滑动地图划不动

### 2.1 根因（先复现，再改）

`ui.js` 的 `bindMapPan()`（原 1943-1957 行）：

```js
const down = e => { ...; sx.x = e.clientX; sx.y = e.clientY; ... };           // ← 触摸时 undefined
const move = e => { const dx = e.clientX - sx.x, dy = e.clientY - sx.y; ... }; // ← NaN
```

- `touchstart` / `touchmove` 是 **TouchEvent**，上面**没有** `clientX/clientY`，坐标在 `e.touches[0]`。
- 于是 `sx.x = undefined` → `dx = NaN` → `el.scrollLeft = sx.l - NaN = NaN`
  → 浏览器把 `NaN` 当非法值忽略 → **滚动位置纹丝不动**。
- 同时 `.map-canvas { touch-action: none }` 已经**禁掉了浏览器的原生触摸滚动**（当初为了做斜向平移）——
  原生兜底没了、自定义又坏了，所以"怎么划都不动"。

**桌面为什么"没事"**：`mousedown/mousemove` 是 MouseEvent，`clientX` 正常 → 鼠标拖得动。
这正是"桌面测试全绿 ≠ 手机可用"的典型。

**变异自证（先确认复现）**：把 `ptOf` 退回 `return {x:e.clientX, y:e.clientY}` →
`smoke-mapui` 实测 `scrollLeft=NaN`（缺陷**真的复现**）→ **5 项变红**（B-4/B-5/B-6/B-9/C-2）。

### 2.2 修法

新增统一取坐标入口（鼠标/触摸二合一）：

```js
const ptOf = e => {
  if (!e) return null;
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY };
  if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY };
  return null;
};
```

`down` / `move` 改走 `ptOf`。**其它一字未动**。

### 2.3 touch 的 `preventDefault` 冲突 & 点击跳房间没坏

- **谁 preventDefault**：只有 `move`（拖动位移 >4px 时）对 `touchmove` 调 `preventDefault`，
  且监听器是 `window.addEventListener('touchmove', move, { passive:false })` —— 允许 preventDefault。
  `touchstart` 是 `{passive:true}`，**不**拦。目的只有一个：拖动时别把整页/整面板一起拖着走。
- **点击跳房间为什么没坏**：`down→move→up` 里，`up()` 只在**这次手势位移 >4px** 时才装一个
  **捕获阶段**的 `click` swallow（`el.addEventListener('click', swallow, true)`，下一帧拆掉）。
  - 纯轻点（位移 ≤4）：不装拦截 → 方块的 `onclick` 照常 → 发出 `go <房间名>`；
  - 拖动（>4）：捕获层 `stopPropagation` 把 click 吞掉 → 不误触走路。
  两条路径 `smoke-mapui` 都用**真触摸事件**验过（C-1 轻点真的发出 `go`；C-2 拖动后不发）。

---

## 3 · 测试：`tools/smoke-mapui.js`（新建）

**33 通过 / 0 失败**，全部**真渲染 + 真触摸**（vm 载真 `ui.js`/`app.js` + 真 `GameEngine.view()` + 真入口 `panel('map')`）：

| 组 | 断言 | 覆盖 |
|---|---|---|
| FE | FE-1/2 | 两份 `ui.js` 逐字节一致；版本戳 ≥7 处且统一 |
| A 窄屏 | A-1~A-8 | 出画布 / `map-narrow` / 方块 **46×46** / 名字 **≤6 字** / 格距 **52px** / 画布宽>屏宽 / **>4 字房名确实显示到 6 字** |
| A 宽屏 | A-9~A-14 | 无 `map-narrow` / 方块 **26×26** / 名字 **≤4 字** / 字号 **8px** / 格距 **30px** / 同一长名只到 4 字 |
| B 触摸平移 | B-1~B-10 | 绑 touchstart+window touchmove/touchend / **滚动真的变** / preventDefault / panning 态 / 捕获拦截 / **轻点不装拦截** |
| C 交互 | C-0~C-6 | 轻点发出 `go` / 拖动后不误触走路 / 点方块弹完整名 / 未探索不剧透 |

**变异自证（三处，均"先确认缺陷复现"再判红绿，还原后全绿）**：

| 变异 | 施加位置 | 结果 |
|---|---|---|
| A 触摸坐标退回 `e.clientX` | `bindMapPan.ptOf` | 实测 `scrollLeft=NaN` → **5 红**（B-4/5/6/9、C-2） |
| B 关掉窄屏自适应 `NARROW=false` | `mapHtml` | 实测方块退回 26×26 / 8px / 名字 4 字 → **4 红**（A-2/4/5/7） |
| C 点方块不弹完整名 | 弹名 handler | **1 红**（C-4），其余保持绿 |

> 防恒真：断言全部读**真渲染出的 HTML / 真触摸后的 scrollLeft**，无 `&& false`、无谓词字面量、
> 无静态 grep、无空 catch。噪声控制：C-2 断言同时看"被吞掉"与"没有发出 go"。

---

## 4 · 需主人真机确认的步骤（手机浏览器，照着点即可）

> ⚠️ 这是**触屏交互**问题，桌面端通过**不算数**（B14-b 只在真触摸事件链上暴露）。

1. 手机连本机同一 WiFi，浏览器开 **`http://<本机IP>:8800/`**（线上是旧版，别用线上地址测）。
2. 进游戏，在输入框输入 **「地图」** 回车（或点左侧「地图」）。
3. **看名字**：确认方块明显变大、房间名是清楚的中文（不再是挤成一团的小字）；
   找一个名字较长的据点（如「江南城·悦来客栈」），**用手指点一下那个方块**，
   顶部应弹出完整房间名（`xx（区域）　n 步`）。切到「天下全图」再看一遍。
4. **拖动平移**：手指按住地图**往左上/右下斜着拖** —— 地图应当跟着手指移动（斜向也能动）。
5. **点走 vs 拖走不打架**：先轻轻点一个**黄框**格子（一步可达）→ 应**真的走过去**；
   再按住**拖动**一段距离后松手 → 应**只是平移、不会误走**。
6. **（横屏）** 把手机横过来再打开一次「地图」，确认名字仍看得清、仍能拖动。

> 判定：第 3 步"点方块看到完整名"、第 4 步"斜向拖得动"、第 5 步"点走/拖不误触"三条全过 = B14 真机通过。

---

## 5 · 改动文件清单

| 文件 | 改动 |
|---|---|
| `game/src/renderer/js/ui.js` | `mapHtml` 尺寸自适应 + `shortName(n,max)` + 点方块弹完整名 + `bindMapPan` 触摸坐标 + `mapScope` 兜底 |
| `server/public/js/ui.js` | 同上（**逐字节同步**，`cmp` 一致） |
| `game/src/renderer/index.html` | 版本戳 `20261010i → 20261010j`（7 处，破缓存） |
| `tools/smoke-mapui.js` | **新建**（33 断言） |
| `design/12-owner-bug-list.md` / `design/13-owner-bug-fix-report.md` | 本文档 |
| `game/data/*.json` | **零改动**（本任务未触碰；见 §7 说明） |
| `css/main.css` | **零改动**（尺寸全部行内，未动 CSS） |

---

## 6 · 回归数字（批次 5 后，2026-10-10）

```
smoke 套数：29（ls tools/smoke-*.js 实数）全 exit=0、✘ 计数全 0
tools/smoke-mapui.js        33 / 0   （本批新建）
tools/smoke-owner-bugs.js  235 / 0   （未改动，回归保持）
tools/smoke-batch4.js       26 / 0   （未改动，回归保持）

mapguide-check.js  72 / 0
map-check.js       6491 / 0   （B14 完成时为 6278/0；随并行 B13 扩图增长，始终 0 失败）
account/dom-page/game-ui/identity/input-guard/kidnap-ui/look-detail/martial-ui/ui-bind 全 0 失败
e2e.js         122 / 0       （修复前 120 / 2，两处历史红同为 mapScope 根因，顺带修好）
两份 ui.js：cmp 逐字节一致
```

---

## 7 · 遗留 / 需知会

1. **`game/data/50_map.json` / `game/data/40_npcs.json` 当前有未提交改动**（mtime 2026-10-10 13:39 / 13:41，
   本任务运行期间由**并行的 B13「世界区块重设计」+ NPC 画像**改动，**非本任务所为**）。
   本任务全程只读数据、**零写入**（自身足迹仅 `ui.js`×2 / `index.html` / `smoke-mapui.js` / 本文档）。
   主理人核对 `git diff --stat -- game/data/` 非空时请知悉这是并行工作的在途改动。
2. **`tools/smoke-portrait.js` 现有 1 处红**（"无画像 NPC 数量 > 300" 实测 281）——
   该套件**不引用 `ui.js`/renderer（0 处）**，纯读 `40_npcs.json`，红灯直接由并行 NPC 画像数据改动引起，
   **与 B14 无关**（B14 起步时该套件为 0 红）。
3. **B13 重排区域后，窄屏/宽屏断言不受影响**（断言读真渲染几何，不写死区域名/房间 id）。
4. **rotate 后需重开地图**才套用新朝向的尺寸（面板在打开时算）；本次未加 resize 监听，属轻量取舍。
5. mapguide-check / map-snapshot / e2e 的 `grab('mapHtml')` 抽取方式未改；
   `mapHtml` 现在**自包含**（尺寸/`mapScope` 就地兜底），对抽取环境更稳。

---

# 批次 5 · B13 · 世界区块重设计（数据）

> 上位方案：`design/19-map-rebalance.md`（设计+叙事，逐房间级清单 + §9 九步执行序 + R1–R12 风险表）
> 归属：**工程 · 数据（map-data）**。本任务唯一被授权修改的数据文件是 `game/data/50_map.json`。
> 与他人的边界：**全程未碰** 任何 `ui.js` / `start.js` / CSS / `tools/smoke-mapui.js`（那是并行的 B14/B15 任务）。

## 0 · 摘要

| 项 | 改前 | 改后 |
|---|---|---|
| `50_map.json` 房间数 | 291 | **312**（+21，+7.2%） |
| region 数 | 34 | **34（不变）** |
| 江南 `jiangnan` 房间 | 56 | **27**（−29） |
| 严格非对称边 | **57** | **0** |
| `map-check` 断言 | 8 条 / 6278 项 | **11 条 / 6492 项**（断言 2 收紧 + §9/§10/§11 新增；CN-B13-2/3 后再 +1） |

## 1 · 现象 / 根因

**现象（主人报）**：「地图区块严重不均：江南 56 房（含 31 座宅院），其他区域多不超过 10 房」。

**根因（数据侧三点）**：
1. **填充物堆积**：`jn_home_01..30` 是 `tools/gen-map.js` 按百家姓批量生成的**纯填充宅院**
   ——扫全库证实**对外零引用**（0 quest / 0 NPC / 0 代码），却占了江南一半房间（30/56）。
2. **假秘境**：`many`、`secret` 各仅 1 房（`road_many_1` / `secret_black_market`），是"路过房"不是秘境；
   `gusu`（慕容世家）仅 3 房，与其分量不符。
3. **假绿**：全图**57 处严格非对称边**（`A.d→B` 而 `B.opp→C≠A` 的单向门/死房），
   而旧 `map-check` 断言 2 **只查"反向方向键是否存在"、不查"是否指回同一房"** → 长期绿着。

## 2 · 修法（数据口径 = `50_map.json`）

- **江南 56→27**：删 `jn_home_02..30` 共 **29** 间；主脉络一间不删
  （出生点 `road_jiangnan_1`、`jiangnan_market/street/inn/temple/gate/…`、3 条民居巷、钱府 3 间、
  5 间铺面、`palace_street` 全保）。同步清除 `jn_resident_1/2/3`、`jn_home_01` 及
  `jiangnan_temple`/`road_jiangnan_2`/`jn_carriage`/`jn_smith_inner`/`jiangnan_hill`/`jn_rich_garden`/`jn_school_herb`
  指向被删房的**悬空出口 24 条**。
- **31 座富户宅去向**：留 2 · 迁 **24** · 拆 5。
  迁建：洛阳 `ly_home_01..04` · 长安 `ca_home_01..04` · 成都 `cd_home_01..03` · 襄阳 `xy_home_01..03` ·
  码头 `hb_home_01..04` · 姑苏 `gs_home_01..03`（含**慕容别院**）· 衙后 `ya_home_01..03`；
  配套 6 条宅巷 `luoyang_mudan_lane`/`changan_huanguan_lane`/`chengdu_jinli_lane`/
  `xiangyang_jiangmen_lane`/`jn_harbor_backstreet`/`gusu_zhai_lane`。新宅 **不用 `hm_` 前缀**。
- **空壳区补 20 间**：`many`1→4（毒沼/野人寨/上古遗迹）· `secret`1→4（鬼市/暗巷/囚笼）·
  `beijiang`3→5（山口/后寨）· `gusu`3→7 · `jinguo`2→4 · `xiake`2→4 · `xixia`2→3 · `haitan`3→4 ·
  `shaolin`/`emei`/`wudang` 各 +1 后山 · `dali`+五华楼 · `miaojiang`+苗寨 · `xiyu`+疏勒镇。
- **`meta.homeRooms`** 同步（去被删、加新宅）。
- **`terrain`** 按新房间集**确定性重算**（复刻 `gen-terrain.js` 算法：大区保留、小区补装饰格），
  使断言 6/7 全绿。
- ⚠️ **region 数恒 34、`meta.startRoom` 不动、`palace_street` 不动**（被 `smoke-guards` 锁）。

## 3 · 57 处历史非对称边 · 逐条处置

**判据（不许一刀切）**：逐条看"这条边是有意单向，还是历史生成脚本的产物"。
本图**没有任何"剧情传送/密道/坠落"类设计单向边**——57 处全部是 `gen-map.js` 的
`link()` 在"方向位被占就自动换向"时留下的方向标签错配（多表现为"两房其实双向可达，但方向标签不互反"，
少数是"反向根本没有"）。**故 0 处标 `oneWay`，42 处修复，15 处随删房消失。**

| 处置 | 条数 | 判据 |
|---|---|---|
| **删冗余正向边**（两房已有一条对称边，这是多出来的重复方向） | 24 | A 另有对称边指回 B → 删 A.d |
| **改到空闲反向方向**（保留 A-B 邻接，换一个 B 侧反向位空的方向） | 13 | `B.opp` 被占、但存在另一方向对（`d'`,`opp(d')`）两侧都空 |
| **补真反向边**（反向位空） | 2 | `B.opp` 原本没有出口 |
| **按方案显式删除**（`jn_home_01 -n-> jn_rich_hall`，`19-map-rebalance.md` §6.1） | 1 | 方案点名 |
| **原方案还原边**（`jn_resident_2 -n-> jn_rich_house` 等） | 2 | 删房后腾出的反向位用于还原真邻接 |
| **随删房消失**（源/目标是被删的 `jn_home_02..30` 及其巷） | 15 | 房间不存在，边自然消失 |
| **有意保留（`oneWay:true`）** | **0** | 无设计单向边 |
| 合计 | **57** | |

**断言 2 的收紧 + 豁免机制**（写进实现，供未来真有单向设计时用）：
> 出口对象可写 `oneWay:true` 显式声明"有意单向"，断言 2 对其豁免严格反向检查
> （但仍要求"目标真实存在"）；同时必须在 `map-check.js` 的 `ONE_WAY_ALLOWLIST` 登记，
> 断言 11 校验"标记数 === 白名单数"，**杜绝拿标记把真 bug 合法化**。本次白名单为空（0 条）。

## 4 · `tools/map-check.js` 断言变更

- **断言 2 收紧**：`ok(!!back[opp])` → `ok(targetOf(back[opp]) === id, …)`，
  失败信息精确到"`A -d-> B，但 B -opp-> C`"。
- **新增 §9 区块均衡度**：每区 ≥3 房（无空壳）、每区 ≤30 房（无独占）、江南 ≤30、总数 280–340。
- **新增 §10 富户宅分布**：江南 `jn_home_*` ≤1；洛阳/长安/成都/襄阳/码头/姑苏/衙门各 3–5；
  荒郊·秘境·邪派（wild/beijiang/xixia/many/haitan/xiake/jinguo/secret/gumu/mojiao/palace）零民宅；新宅不用 `hm_` 前缀。
- **新增 §11 无悬空出口 + 显式单向边白名单**。
- 合计 **6492 通过 / 0 失败**（经 §11 CN-B13-2/3 收紧后；CN 前为 6491）。

## 5 · 变异自证（先确认缺陷复现，再判红绿）

- `node tools/mutate.js b13-asym-edge`：把 `jiangnan_market.u→jn_market_main` 改回历史上的 `-n->`
  （正是 `19-map-rebalance.md` §7.1 举的例子）。
  **先确认缺陷真的复现**：`jn_market_main.s` 仍指 `jn_fruit_stall`（非回指 `jiangnan_market`）。
  旧断言（只查反向键存在）→ **绿**（`back['s']` 存在，假绿）；新断言 → **红**：
  `非严格反向：jiangnan_market -n-> jn_market_main，但 jn_market_main -s-> jn_fruit_stall`（**6489/2**）。
  `mutate.js restore` 后 `cmp` 逐字节一致，恢复 **6491/0**。
- **新增断言可判红**（防空转）：把 `ly_home_01.region` 挪进 `wild` + 造一条 `secret_cage.e→no_such_room` 悬空边
  → §2/§10/§11 各红 1 项（**6487/3**，exit=1）；还原后 **6491/0**。

## 6 · 回归数字（批次 5 后）

```
tools/map-check.js      6492 通过 / 0 失败   （原 6278；断言 8→11 条；§11 CN-B13-2/3 后 +1）
tools/mapguide-check.js   72 通过 / 0 失败   （未改，保持）
连通性 (road_jiangnan_1 BFS)  312 / 312 可达
全量 tools/smoke-*.js    29 套（B13 数据改动落地时实测全 exit=0、零 ✘）
  · 关键锁定套全部保持：mapguide-check / smoke-guards(palace_street) /
    smoke-b9-intro(出生点 road_jiangnan_1) / smoke-estate / smoke-visit-house
```

> ⚠️ **并行任务在途导致的两处红**（**均与本任务无关**，且都不是 map 数据引起）：
> ① `smoke-b9-intro` 在某次批量复跑时捕获到 `tutorial.js` 正被 **B16 任务**半写的瞬间（单独复跑 **114/0 全绿**）；
> ② `smoke-portrait` 的「**无画像 NPC 数量 > 300**」断言 —— **画像任务（roster）**正在给 NPC 批量补 `portrait`，
> 无画像数已降到 277（实测：其中 room 指向被本任务删除房间的 = **0**，即与 map 重排完全无关），
> 该断言的阈值需由**画像任务自己**随画像推进同步更新。
> 佐证：B13 数据改动**单独落地时**的整跑（`ls tools/smoke-*.js` = 29 套，含 `smoke-mapui.js`）**全部 exit=0、零 ✘**。

## 7 · R4（生成器回流）· 已除弹

- `tools/gen-map.js`（**会重造 `jn_home_01..30`**）与 `tools/gen-homes.js`（会重排 `hm_*`/巷道）
  加**硬守卫**：检测到 B13 成品（含 `ly_home_01`/`many_ruin`/`secret_cage` 等哨兵房）即 `process.exit(2)`
  拒绝运行；确需重建须显式 `FORCE_GEN_MAP=1` / `FORCE_GEN_HOMES=1`。实测：两脚本跑 => exit=2，
  `50_map.json` **md5 前后一致（文件零改动）**。
- `tools/patch-guard-gates.js` 的 `jn_home_09` 旧洞（冯宅→尚膳房）**已加注**；
  `cutEdge()` 对**已删房**走 `problemsEarly('脏连线源房间不存在…')` → 最终 `problems` 非空 → 打印「未落盘」并 `exit(1)`
  （**硬失败退出、非「自动跳过」**；该脚本不进 CI，且不会静默覆盖，影响可忽略）。

## 8 · 改动文件清单（B13）

| 文件 | 改动 |
|---|---|
| `game/data/50_map.json` | **唯一数据改动**：删 29 / 迁 24 / 补 20 / 新增 6 巷 / 修 42 非对称边 / 重算 terrain / 更新 meta |
| `tools/map-check.js` | 断言 2 收紧为严格反向（含 `oneWay` 豁免）+ 新增 §9/§10/§11 |
| `tools/gen-map.js` | **加 B13 硬守卫**（防重造 `jn_home_*` 覆盖手改） |
| `tools/gen-homes.js` | **加 B13 硬守卫** |
| `tools/patch-guard-gates.js` | `jn_home_09` 旧洞加注 |
| `tools/mutate.js` | 新增 `b13-asym-edge` 变异用例；`restore`/`check` 纳入 `50_map.json` |
| `game/src/core/world.js` | **§10 连带收尾**：`deserialize` 加「房间不存在→回 `meta.startRoom`」兜底 + 提示 |
| `game/src/core/commands.js` | **§10 连带收尾**：`go`（:191）/`look`（:475）出口分支加 `if(!room)` 防御；`doMove`（:170）接住 `movePlayerTo` 的 `ok:false` |
| `game/src/core/engine.js` | **§10 连带收尾**：`view()` 顶 `_migrateNotice` 到 `room.desc`；`exec()` 一撤提示 |
| `tools/smoke-map-migrate.js` | **新建**：旧档软锁回归 30 条（§10） |
| `tools/mutate.js`（2/2） | 新增 `b13-save-fallback` / `b13-room-guards` 变异用例；`commands.js` 纳入 restore/check |

**未改**：所有 `ui.js` / `start.js` / CSS / `smoke-mapui.js`（并行任务）；`hm_*` 24 房；`private:true` 语义；
`house:<npcId>` 虚拟私宅；`region` 数；`meta.startRoom`；`game/data/` 本轮除 `50_map.json` 外零改动。

## 9 · 遗留 / 需知会

1. **`private:true` 未动**：本次只删"自己认的" `jn_home_02..30`，**没有按 `private` 一刀切**
   （`private` 是 estate/home/sectFounder 的既有语义）。
2. **R9 命名/归属（已存在，非本次引入）未改**：`wild` 区里仍有 8 个"城西 `jn_*`"房、
   `jiangnan` 区里有 `palace_street`（皇城御街）、`market.jm_underground` 与 `secret.secret_black_market`
   两个"黑市"——本轮**只登记不改**（改连通风险高，留后续）。
3. **`test_room` 未删**（**更正**：`qa-b13` 查实它**不在** `50_map.json`，而来自已启用的 mod
   **`mods/test_mod/mod.json`**，运行时并入世界 → 引擎合并后 317 房 / 35 区）。它**非成品基础数据**，
   属用户可控的 mods 层；删它会动别人的 mod，故保留并登记。
4. **存档兼容（R10）**：见下方 §10 —— **已修**（旧档停在已删房 → 读档软锁，已加兜底 + 提示 + 回归）。
   ⚠️ **时序更正**：该兜底**不是交付即有**——13:50 交付件读旧档会**永久软锁**（`qa-b13` 首次实测，见 `design/22-b13-acceptance.md` §3.2）；
   兜底 + `smoke-map-migrate.js` 是 **13:51 验收途中**才补上的。原 §9.4 旧稿「引擎有回出生点兜底」的说法**不成立**，已随本节改写。

---

## 10 · 连带收尾：旧存档「停在已删房」的读档软锁（已修）

> 起因：`qa-b13` 预判的 R10 项。复核 `deserialize` 后**确认为真缺陷**并修复（team-lead 批准）。
> **时序（据 `design/22-b13-acceptance.md` §3 / §12 更正）**：B13 交付件（13:50）**无此兜底**，
> 读一张停在已删房的旧档会**永久软锁**（`qa-b13` 首次实测）；修复 + `smoke-map-migrate.js` 于 **13:51 验收途中补上**。
> 即本条属**「交付后补」而非「交付即有」**——留此记录以免后人误以为交付时已完备。

**缺陷（先复现）**：造一份 `player.room='jn_home_05'`（已删房）的旧档 → `deserialize` **无校验**，
直接把玩家留在不存在的房间 → 实测：
- `look` 显「这里一片虚无。」、方向键「你似乎迷失在了虚空之中。」（原地不动）；
- **`go 江南大路` 抛异常** `Cannot read properties of undefined (reading 'exits')`（`commands.js` go handler 拿 undefined 房间后 `room.exits`）；
- `看 北`（look 的出口回退分支）同样崩。
→ 净效果：**读档即软锁**。全域扫描 80 条高频指令，崩溃点仅 2 处（go / look）。

**修法（4 处，`game/data/*.json` 零改动）**：
1. `game/src/core/world.js` · `deserialize` 收尾：`if (!this.data.rooms[p.room]) p.room = meta.startRoom`，并置
   `_migrateNotice`（玩家可见提示）+ 记 `p.log` + `world._roomMigrated`（from/to 留痕）。
2. `game/src/core/commands.js` · `go` handler（`:191`）：`if (!room) return {warn}`（运行期防御）。
3. `game/src/core/commands.js` · `look` 出口回退分支（`:475`）：同上防御。
4. `game/src/core/commands.js` · `doMove`（`:170`）：接住 `movePlayerTo()` 的 `{ok:false}`（此前被忽略、会谎报 `moved:true`）。
   （`engine.view()` 把 `_migrateNotice` 顶在 `room.desc` 前 —— 因读档路径前端**不渲染** `lines`、只渲染 `room.desc`，
   且本轮不动前端；玩家一动 `engine.exec` 即撤掉提示，不长期挂描述。）

**同类排查（`p.room` 解引用全仓扫描）**：`grep getRoom(X.room)` 出 ~40 处，逐处判定「房间不存在会怎样」：
- **会崩（已加防御 2 处）**：`commands.js:190`(go) + `:473`(look 出口分支)。全域扫 80 条高频指令，**仅此 2 处**崩。
- **已自带守卫（无需改）**：`commands.js`（139/270/445/938/1577/1612/2270/2281/2589/2662/2679/2771/2814）、
  `engine.js`（269/465/681）、`estate.js`（278/363/400）、`farm.js`（46/113）、`gather.js`（96）、
  `home.js`（140/240/275/296）、`marriage.js`（552）、`kidnap.js`（496/699，未解引用 `room`）。
- **`movePlayerTo` 调用方**：`:1001` 已判 `if(!mv.ok)`；`:170`(doMove) 原先**漏判**→ 已补（修法 4）；
  `engine.js:863`/`survival.js:54`/`modapi.js:487` 为「传送到计算出的已知合法房」，忽略返回可接受（已登记）。

**测试**：新建 `tools/smoke-map-migrate.js`（**32 项 / 0 失败**）：① 读档不再软锁且落 `meta.startRoom`；
② `go/北/look/背包/状态/武学/地图/出口` 全不抛异常且移动生效；③ 有提示（不静默）且一动即撤；
④ 绕过 `deserialize` 的运行期防御（非法 roomId 下 go/看 友好提示；幽灵出口不谎报移动）；
⑤ 正常档位置不变（`jiangnan_market`/`palace_street`）。

**变异自证**（先确认缺陷复现再判红绿）：
- `mutate.js b13-save-fallback`（注释掉兜底）→ 复现「读档后仍停在 `jn_home_05`、无提示」→ 断言 1.2/1.3/1.4/3.1/3.2/3.3 **6 红**；还原 30/0。
- `mutate.js b13-room-guards`（拆 go/look 防御）→ 复现「`go` 抛 `reading 'exits'`」→ 断言 4.1×2 **红**；还原 30/0，无 `.mutbak` 残留。

**回归**：`map-check` **6492/0**、`mapguide-check` **72/0**、全量 **31 套 smoke 全绿零 ✘**。

---

## 11 · 验收收尾（`design/22-b13-acceptance.md` 的 CN-B13-1..4）

`qa-b13` 独立验收判 **🟡 CONCERNS（有条件放行，无功能阻塞）**；下列 4 条收尾已全部做掉：

- **CN-B13-1 · 纳入常规回归 + 时序更正**：
  `smoke-map-migrate.js` 本就在 `tools/smoke-*.js` 命名空间（全量脚本自动纳入）；
  另在 `README.md` §十一 写明「**全量回归 = `for f in tools/smoke-*.js`（现 31 套）**」并登记本文件；
  `design/12-owner-bug-list.md` 基线已列 `smoke-map-migrate`。
  **时序更正**：见 §9.4/§10 —— 兜底属**「交付后补」**（13:50 交付件无；13:51 验收途中补），非「交付即有」。
- **CN-B13-2 · §9 总数收紧**：`280–340` → **`305–320`**（目标 312）。变异自证：注入 12 填充房使总数 325
  → §9 红「总数异常：325」；旧区间（≤340）不会拦（正是验收方变异 C 溜过之处）。
- **CN-B13-3 · §10 加江南直测**：新增 `ok((perReg.jiangnan||0) <= 1)`（与 `jn_home_` 前缀断言双保险）。
  变异自证：江南塞 1 座非 `jn_home_` 前缀民宅 `zz_home_01` → §10 红「江南仍堆着 2 座富户民宅」。
- **CN-B13-4 · 冻结 md5 纪律**：本轮 B13 冻结基线 **`50_map.json = baf7a2a48301ec158527d3a7cf99ea91`**
  （与本 §11 同批的 `map-check.js` 为 CN 后修订版）。**今后验收：先冻结被测文件 md5，窗口内不改源码**（已写入 `README.md` §十一）。
- 额外（验方建议、非阻塞）：在 `map-check.js` §2 注释写明「`via/hint` 交互出口（跳崖/爬上去）**同样要求真反向边**，不许用 `oneWay` 开后门」。

**本批改动文件**：`tools/map-check.js`（§9 收紧 / §10 +江南 / §2 注释）、`tools/patch-guard-gates.js`（措辞更正）、
`README.md`（全量回归口径 + 冻结纪律）、`design/13-owner-bug-fix-report.md` + `design/12-owner-bug-list.md`（回填）。
**`50_map.json` 未动（md5 仍 `baf7a2a4…`，已封版）。**

**回归（CN 后实测）**：`map-check` **6492/0**、`mapguide-check` 72/0、**31 套 smoke 全绿零 ✘**。

---

# 批次 5 · 画像落地（26 张反面画像灌入 + 落地管线）

> 任务：PORTRAIT-LAND（工程负责人）　范围：把 `design/portraits-new.json`（26 人 · 13 字段齐全）
> **真正灌进游戏、并让玩家看得见**；建生成器与回归测试。
> 依据：`design/01-npc-portrait-spec.md`（§1.1 挂 `def.portrait` / §1.2 字段表 / §3.4 露出层）
> 与 `design/15-portrait-roster.md`（V01–V26 名录 / §5.2 marks 词典 / §5.5 8 条质量红线）。
> 未碰（并行任务）：`50_map.json` / `map-check.js` / 任意 `ui.js` / `smoke-mapui.js`。未 `git commit`。

## 0 · 摘要

| 项 | 结论 |
|---|---|
| 挂载策略 | **(a) 直接注入 `40_npcs.json`**（与既有 16 张画像同源），弃 (b) 独立数据文件 |
| 画像落库 | 26 人全部挂 `def.portrait` 且 `v===1`；全库画像 **16 → 42**（A 39 / B 3） |
| 只加不改 | 与 HEAD 逐 NPC 深比对：**除 portrait 外零字段差异**（26 人新增、16 人原样、其余不变） |
| 写入格式 | `JSON.stringify(data, null, 1)`；实测对原文件**逐字节可还原**（553824→553824） |
| 生成器 | `tools/gen-portraits.js`（新）· 幂等 / `--tier` / `--check` / 剥离 `_` 键 / 写前逐条必填校验 |
| 测试 | `tools/smoke-portrait-batch.js`（新）· **293 通过 / 0 失败** |
| 变异自证 | 新增 3 个 case（`portrait-no-clone` / `portrait-drop-routine` / `portrait-drop-ask`）全部**先复现缺陷再判红** |
| 回归 | 全量 `tools/smoke-*.js` **30 套全 exit=0、零 ✘** |

## 1 · 挂载策略：选 (a) 直接注入 `40_npcs.json`（附 (b) 实测）

**决策：走 (a) 直接注入。** 三条理由，均经实测：

1. **同源一致性**：规格 §1.1/§4.1 定的就是 `def.portrait` 挂在 `40_npcs.json` 里；且**世界已有的 16 张画像本就在 `40_npcs.json` 内**。若新批改走独立文件，画像数据会**两处存放**，反而破坏"唯一来源"。
2. **写入干净可审**：`40_npcs.json` 用 **1 空格缩进**（不是规格 §5.4 说的 2 空格）；`JSON.stringify(parsed, null, 1)` 对原文件**逐字节还原**（实测 553824 字节 `exact === raw`）。故注入后的 diff 只含新增的 26 段 portrait（git 因「末字段行补逗号」把 91 行计为改动，语义上仍是纯新增 —— 见 §3）。
3. **不押隐式前提**：方案 (b) 的正确性依赖「文件名排序 40 < 41」+「`mergeEntry` 走 deepMerge」两个隐式前提，任何一个变动都会静默出事，收益为负。

**方案 (b) 实测结论（备查）**：`world.js#mergeData`（216 行）对 `npcs` 集合是**按 id 的逐字段深合并**，**不是整体覆盖**：

- `mergeData` 对每个 id 调 `mergeEntry(this.data.npcs[id], Object.assign({id}, entry), …)`；`mergeEntry` 见 `base` 存在即 `deepMerge(base, over)`（`utils.js#deepMerge` 递归合并对象，数组按 `arrayMode` 替换）。
- 实测：造 `40_npcs.json`（2 个 NPC，带 name/desc/hp/tag/rel）+ `41_portraits.json`（只给 npcA 补 portrait）→ `World.loadBaseData()` 后：**npcA 的 name/desc/hp/tag/rel 全保留、portrait 注入成功、npcB 不受影响、NPC 总数仍为 2**（没被冲掉）。
- 即 **(b) 技术上可行**，但仍被上面第 1、3 条否决。

## 2 · 画像字段 ↔ 后端/前端真实读取对齐表

> 关键：**本项目反复踩「渲染读一个字段、判定读另一个」的静默坑**。下表由 `smoke-portrait-batch.js` §1
> **驱动真指令**（`look` / `talk` / `ask`）在 26 人样本上跑出来，不是静态 grep。

| 字段 | 真实读取点 | 玩家可见？ | 26 人实测 |
|---|---|---|---|
| `routine` | `commands.js#routineNow` → `lookRoom`（房间行 `npcsact`）+ `lookNpc`（单人）；另 `kidnap.js` | **✅ 看得见** | 26/26 |
| `voice.catchphrase` | `personality.js#catchphraseOf` → `commands.js` talk 前缀（A 30%） | **✅ 听得见** | 26/26 |
| `voice.tone` | `personality.js#sayVerbToned` → talk 说话动词（仅 敬/泼/酸 顶掉 personality） | **✅ 听得见** | 7 条 tone∈{敬,泼,酸} 全部生效 |
| `voice.taboo` | `commands.js` ask 命中 → 掉好感（A 权重 −15） | **✅ 生效** | 26/26 |
| `origin` | `commands.js` ask L2（trust≥0）+ `engine.js#askTopicsOf` | **✅ 问得出** | 26/26 |
| `now` | 同上（trust≥20） | **✅ 问得出** | 26/26 |
| `want` | 同上（trust≥50） | **✅ 问得出** | 26/26 |
| `fear` | 同上（trust≥70） | **✅ 问得出** | 26/26 |
| `tier` | `catchphraseRate` / taboo 权重 | ✅（间接） | — |
| `obsession` | 仅 `world.js#portraitMoodBias`（−5 mood），**文本不露** | ⚠️ 间接 | 死字段 |
| `marks` | 仅 `portraitMoodBias`（丧亲 −8 / 新婚·得子 +10），**文本不露** | ⚠️ 间接 | 死字段 |
| `role` | **无任何读取点** | ❌ 死字段 | 26/26 零出现 |
| `secret` | **无任何读取点**（L4 泄密未实现） | ❌ 死字段 | 26/26 零出现 |
| `feuds` | **无任何读取点** | ❌ 死字段 | 26/26 零出现 |
| `hooks` | **无任何读取点**（待事件库批次） | ❌ 死字段 | 26/26 零出现 |
| `arc` | **无任何读取点**（设计期校验用 `arc.init`==`favorInit` 档） | ❌ 死字段 | 26/26 零出现 |
| `voice.style` | **无任何读取点**（给写手看的执行说明） | ❌ 死字段 | 26/26 零出现 |

**前端说明**：两份 `ui.js` **都不读** portrait（`grep -rn portrait game/src/renderer/js/ui.js server/public/js/ui.js` = 空）。
画像文本经引擎指令处理器（`commands.js`）拼成 `lines` 返回，`ui.js` 只负责把 `lines` 渲染进 `#log`。
故"画像↔前端"不存在字段错配，**对齐点在 commands.js**，本测试即打在 `ui.js` 的真渲染出口上验证（§6）。

## 3 · `spawnNpc` 是否 clone `portrait`（铁律 14）—— 实测：**已 clone**

`world.js#spawnNpc`（814 行）现状：

```js
npc.portrait = def.portrait ? clone(def.portrait) : null;
npc.pstate   = { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
if (npc.portrait) npc.pstate.moodBias = portraitMoodBias(npc.portrait);
```

实测（`smoke-portrait-batch.js` §2）：两个实例的 `portrait` **不是同一个对象**、也不是模板对象本身；
深改实例的 `secret.text` / `pstate.trust` **不污染模板、不污染另一实例**；`pstate` 六字段齐全且随档 round-trip。
—— 即"改一个带动全江湖"的坑**已被引擎侧堵住**，本批次无需改引擎。

## 4 · 生成器 `tools/gen-portraits.js`（新）

- **只补 portrait**：对每个 id 只写 `def.portrait`，其余字段一个不碰（§3 已用「与 HEAD 深比对零差异」证）。
- **剥离 `_` 键**：`stripDeep()` 递归剥掉所有 `_` 开头键（`_note` 等设计说明），实测注入的 26 份 portrait **零 `_` 键**；源文件每条都带 `_note`（证明剥离确实发生，非空跑）。
- **幂等**：`def.portrait.v === 1` → 跳过；`lock === true` → 受保护永不覆盖。跑两次输出**逐字节一致**；把 26 张全删后从零生成，**能还原出磁盘那一份**（确定性）。
- **`--tier=A` / `--check`（只校验不写入）/ `--file=` 可指定源**。
- **写前逐条必填校验**（§1.2 必填列 + 15 §5.5）：缺字段/类型错/`voice.tone` 越界/`routine.at` 越界/`feuds` 不在 `rel` 或 kind 不符/`arc.init` 与 `favorInit` 不同档/`secret.leakTo` 空或 id 不存在/`hooks.trigger` 嵌套 >3/禁用现代词/女性出现「汉子/他」/catchphrase 互重 —— **任一不合格 → 报错指出「哪个 NPC 的哪个字段」并拒绝落盘**。
- **`--check` 校验"磁盘上那一份"**：若该 NPC 已有 `v===1` 的 portrait，则校验磁盘现存件（而非源文件）—— 使 `--check` 成为**已落库数据的回归闸门**（改坏一条会判红，§2 已自证）。
- **落盘**：先备份到 `tools/_bak/`（已 gitignore），再 `JSON.stringify(data, null, 1)` 写入。

## 5 · 测试 `tools/smoke-portrait-batch.js`（新）

**293 通过 / 0 失败**。分 6 节：0 前置事实 / 1 字段↔读取对齐 / 2 clone / 3 幂等 / 4 质量红线 / 5 真实渲染 / 6 变异对应表。

质量红线（15 §5.5 与规格 §0）：女性无「汉子/他/爷们/兄弟」（26 人）；反面（marks 含 `伪/叛/诈/赃/盐/粮/刑`）**必有 hooks**（15 人样本）；catchphrase **本批 26 零重复 + 全库 42 零重复**；A 层 13 字段齐全；禁用现代词；feuds ⊆ rel 且 kind 一致；`arc.init`==`favorInit` 档；`secret.leakTo` 非空且 id 存在；`hooks.trigger` 深度 ≤3；规格 §0 的 B1（无重复 desc / 女性无「汉子」）、B4（child ≤14 / 出家人 ≥20）。

## 6 · 真实渲染（vm 载入真 `ui.js`）

用 DOM stub（照 `smoke-owner-bugs.js` 三坑：`querySelectorAll` 按 (选择器, innerHTML) 缓存 / `innerHTML` setter 清 children / async 要 await）载入真 `app.js`+`ui.js`，把 `WX.api.exec` 接到真 `GameEngine.exec`，走 `WXUI.doCmd()` 真渲染并读 `#log`：

| NPC | `look` 看到的 routine | `ask 来历` 看到的画像 |
|---|---|---|
| 穆逢 `npcv_154`（女·泼） | 「坐在前厅的账台后头拨算珠，眼睛扫着每一个上楼的客人」 | 「她自己就是被卖进来的，十四岁那年被人牙子牵过了江……」 |
| 和放 `npcv_241`（男·冷） | 「坐在南巷铺子的太师椅上，看进来看出去的每一个人，算盘一下不动」 | 「祖上开当铺，到他手里只剩一间。他年轻时替人跑腿收账……」 |
| 阮听 `npcv_090`（男·冷） | 「在市集口等活，站着不动，像随时要走」 | 「他年轻时是个正经游侠，替人押货、替人打抱不平……」 |

三人的 routine 与 origin 均**出现在玩家能看到的 `#log` DOM 文本里**。

## 7 · 变异自证（先确认缺陷复现，再判红绿）

新增 3 个 `tools/mutate.js` case（`applyMutate` 自带「施加后 grep 校验 marker」+「还原后 cmp 逐字节一致」）：

| 变异 | 改动点 | 预期红项 | 实测 |
|---|---|---|---|
| `portrait-no-clone` | `world.js`：`npc.portrait = def.portrait ? clone(...) : null` → 去掉 `clone` | §2 的 2.3/2.4/2.7/2.8 | **红**（4 条），还原 cmp ✔ |
| `portrait-drop-routine` | `commands.js`：`routineNow` 取 `portrait.routine` 那行 → 置 `null` | §1 的 1.L0 全 26 + 1.A | **红**（26+ 条），还原 cmp ✔ |
| `portrait-drop-ask` | `commands.js`：`if (!found && npc.portrait)` → `if (false && …)` | §1 的 1.L2 origin/want/fear + 1.F taboo | **红**（26×4 条），还原 cmp ✔ |

三组均**先复现缺陷**（红项正是对应断言），还原后基线复跑 **293/0**，`mutate.js check` 无 `.mutbak` 残留。

## 8 · 回归数字（批次 5 · 画像落地后）

- 全量 `ls tools/smoke-*.js` = **30 套**，**全部 exit=0、零 ✘**。
- 新增 `tools/smoke-portrait-batch.js` **293 通过 / 0 失败**。
- `tools/smoke-owner-bugs.js` **235/0**、`tools/smoke-portrait.js` **全绿**（未改动逻辑，仅同步阈值，见 §9-3）。
- `map-check` / `mapguide-check` / `e2e` 保持；本轮未触碰地图/UI 文件。

## 9 · 改动文件清单 / 遗留

**改动文件**：

| 文件 | 改动 |
|---|---|
| `game/data/40_npcs.json` | **唯一数据改动**：26 人各新增一个 `def.portrait`（纯新增，其余零差异） |
| `tools/gen-portraits.js` | 新建（生成器） |
| `tools/smoke-portrait-batch.js` | 新建（回归测试，293 断言） |
| `tools/mutate.js` | 新增 `portrait-no-clone` / `portrait-drop-routine` / `portrait-drop-ask` 三 case；`restore`/`check` 纳入 `commands.js` |
| `tools/smoke-portrait.js` | **仅同步 1 条过时阈值**（见下 9-3） |

**未改**：`50_map.json` / `map-check.js` / 两份 `ui.js` / `smoke-mapui.js` / 全部 `game/src/**`（画像读取链在批次内已由引擎侧就绪）。

**遗留 / 需知会**：

1. **6 个字段仍是"死字段"**（`role` / `secret` / `feuds` / `hooks` / `arc` / `voice.style`）：本批已把数据备好，但**渲染链未接**——L3「打听」、L4「泄密」、L5「目击」与事件库属后续批次（规格 §3.4 P5 / §5.5）。玩家当前只能看到 routine / catchphrase / tone / taboo / origin / now / want / fear。**这不是 bug，是分层落地的既有计划**，此处登记以防误判"写了没露"。
2. **marks 词典缺 3 项**：`npcv_248` 用 `税`、`npcv_083` 用 `书`、`npcv_074` 用 `茶`，均**不在 `15-portrait-roster §5.2` 的词典**里。生成器判为**软提示（不阻断）**并报告；建议设计侧回填词典或改用近义 mark（`税→官·商`、`书/茶` 需新增）。
3. **`smoke-portrait.js` 阈值同步**：其断言「无画像 NPC 数量 > 300」是第六批留下的**硬编码下限**，本批 +26 张画像后无画像数由 307 → **281**，合法跌破。已改为**比例断言**（`> 全库 × 0.7`），并在注释里写明演进；B13 批次报告（§6 尾注）也已预告"该阈值需由画像任务自行同步"。
4. **`met` 语义**：引擎 `pstate.met = false`（布尔），规格 §1.3 写的是 `met: int ≥0`（见面次数）。本批未改（属引擎侧既有实现），如需按规格改为计数，另开小任务。
5. **未 `git commit`**：所有改动留在工作区，等主人审批。

---

---
---

# 批次 6 · 任务数据（B20 模板支线串号修正 + E4 第一幕假结局摘除）

> 交付人：**eng-quest（工程负责人 · 技术/引擎）**　日期：2026-10-10　任务号：QUEST-DATA
> 唯一数据改动文件：**`game/data/60_quests.json`**（未碰 `40_npcs.json` / `50_map.json` / `game/src/**`）
> 上游依据：`design/23-sidequests-portrait-hooks.md` §0.1/§8/§11（B20）· `design/21-mainline-act3-5.md` §2.9 / §2.9.1 / §9-E4（E4）

## 0 · 摘要

| 条目 | 现象 | 处置 | 结果 |
|---|---|---|---|
| **B20**（高） | 288 条 `sq_npcv_*` 同模板套出的跑腿，**目的地跨区 135 条**（江南高利贷主让你去峨眉）、**点名张冠李戴 4 条**、**288 条全是「多谢你了」** | A 层 26 人（V01–V26）模板**停用**；其余 262 条**修串号后保留为「杂务」** | 跨区 0 · 张冠李戴 0 · say 由 1 种 → **33 种**；id/var/奖励数值**一律未动** |
| **E4**（P0） | `q_main_jianghu.rewards` 自带 `ending: jianghu_end`，**第一幕就弹「故事终章」**，三结局没机会出场 | 删除该 `ending` 效果，改由一条 `narrate` 收尾 | 专项断言「第一幕走完不产生 `ending_*`」**改前红 → 改后绿** |

**一句话**：把主人抱怨的「AI 感」源头——那批「无人物、无具体事、还送错地方」的模板跑腿——**按两条路一次性清算**：值得写的人（A 层 26）腾位给真支线，不值得的人（262）改成「本城本事的杂务」。

## 1 · B20 现象与实测（改前 · 全量扫描）

对**改前**的 288 条 `sq_npcv_*` 逐条扫描（判定口径写在 §3，脚本读 `40_npcs.json` 只读）：

| 指标 | 改前（288 条） |
|---|---|
| 目的地 **跨 region**（≠ giver 所在区） | **135**（46.9%） |
| 点名之人**根本不在 giver 的 `rel` 里**（张冠李戴） | **4** |
| 点名之人虽在 `rel`、却**住在别的 region** | **117** |
| `say` 文案**种类** | **1**（288 条全是「多谢你了。」） |
| 两段 `desc` 组合**种类** | 284（有 4 组完全重复） |

**4 条张冠李戴（点名之人查无在 `rel`）**：`sq_npcv_076`（点名「孟明」）· `sq_npcv_184`/`sq_npcv_250`（点名「麻灵」）· `sq_npcv_268`（点名「孟明」）。

**样板实例 `sq_npcv_241`（和放 · 东市·南巷 · 放高利贷）改前**：

```
desc  「和放要你替他跑腿买些日用杂货。」
stage0「去集市买些日用杂货」  →  go 目标  emei_qingyin（峨眉·清音阁）
stage1「把东西交回给史倦客」
say   和放点点头：「多谢你了。」   favor 和放 +8
```
——一个**江南东市**的高利贷主，让你**跑峨眉**买杂货，再把东西**交给一个远在别处、line 不上的人**。主人所说的「AI 感」，这条就是活证据。

> 补充实测（供知会）：这批 `sq_npcv_*` **当前并无 NPC 主动挂载**——`40_npcs.json` 里 288 个 NPC 只有 `sidequest` 字段，而引擎**没有任何代码读 `sidequest`**（`def.quests` 仅 14 个手工 NPC 有）。即：现在既不会在 NPC 菜单「接他的任务」里出现，也不会出现在 `quests` 的「可接任务」里；**但可以直接 `accept <任务名>` 接取**（已实测 `accept 和放的采买` 成功）。这一点影响了 §2 的「停用方式」选择。

## 2 · 处置：A 层 26 人 → **停用（从 `quests` 移除）** — 方式与理由

**方式**：把 26 位 A 层 NPC（V01–V26）对应的 `sq_npcv_*` 从 `60_quests.json` 的 `quests` 表中**整体移除**（不是加标记）。

**26 条被移除的 id**（＝ `design/23` §8 的 17 条 + §11 的 9 条）：

```
sq_npcv_241  sq_npcv_154  sq_npcv_010  sq_npcv_208  sq_npcv_091  sq_npcv_065  sq_npcv_223
sq_npcv_174  sq_npcv_240  sq_npcv_009  sq_npcv_237  sq_npcv_248  sq_npcv_215  sq_npcv_180
sq_npcv_115  sq_npcv_083  sq_npcv_126  sq_npcv_164  sq_npcv_186  sq_npcv_090  sq_npcv_074
sq_npcv_252  sq_npcv_178  sq_npcv_095  sq_npcv_036  sq_npcv_082
```

**为什么选「移除」而不是「加 `deprecated` 标记」**：

1. **标记挡不住「accept 直呼其名」**：`accept` 处理器用 `fuzzyFind` 在整个 `quests` 表里按名字找（`commands.js:2236`），**不检查任何 disabled/deprecated 字段**。实测 `accept 和放的采买` 现在就能接。**只要对象还在表里，玩家/脚本就能把它接起来** —— 而任务要求的硬指标是「**玩家不会同时看到旧模板与新支线两条挂在同一个人身上**」。标记做不到「绝对看不到」，**移除做得到**（对象不存在 → `fuzzyFind` 找不到 → 回「没有这个任务」）。
2. **面向未来同样成立**：`design/23` §0.2 设想 `hk_*` 支线落地后与 `sidequest`/`def.quests` 挂钩。若某天有代码把 `sidequest → def.quests`（这正是这批数据**被生成出来**的用途），标记会被忽略、模板照样被挂上；**移除则永不复活**。
3. **存档代价实测 ≈ 0**：这批任务**没有 NPC 挂载**（见 §1 尾注），玩家几乎不可能「自然接到」；`accept <名>` 又需要先知道任务名。因此移除**不会**踩坏真实存量存档。
4. **运行时对新 N 全安全**：读档后所有消费点都做了空值兜底——`quests` 面板 `if (!qd) continue`（`commands.js:2202`）、`checkQuestAuto` `if (!qd || !qd.stages) continue`（`engine.js`）、`canVisitHouse` 用 `(d.quests||[])`。`id` 未改名（不破坏任何引用）。
5. **不引入悬空**：已核对 60_quests.json 内**没有**任何 `require` / `quest` 效果指向这 26 条（每条 id 仅出现在自身定义内）。

**⚠️ 需要移交的连带**（本任务无法处理，因 `40_npcs.json` 属并行任务 eng-b8 的工作区，明令「不要碰」）：
26 位 NPC 的 `def.sidequest` 仍写着已被移除的 `sq_npcv_XXX`。**当 `hk_*` 支线落地时，须把对应 `sidequest` 改指 `hk_*`**（或落地方在挂钩代码里跳过 deprecated/缺失 id）。**这是「替换」这条链条的最后一环，登记在 §10 遗留。**

## 3 · 处置：其余 262 条 → 修「串号」后**保留为杂务**

**三条硬规则（`tools/gen-quests-b20.js` 确定性生成，以 id 哈希作种子，可复跑）**：

| # | 规则 | 实现 |
|---|---|---|
| ① | **目标人名必须 ∈ giver 的 `rel`**（且**同 region 优先**）；没有可挑的关系人 → **泛称**（「衙门口当差的」「铺子里的掌柜」「街面上的熟人」…），**绝不张冠李戴** | `pickRel()` 只在 `rel` 里选，且要求关系人所在 region ＝ giver 所在 region |
| ② | **目的地必须落在 giver 自己的 region**（`50_map.json` 的 `region`），且 ≠ giver 自己房间、非 `private`、非 `hm_*` 私宅 | 从同 region 房间池确定性抽取；「采药/除害」软偏好野地房名、「采买/寻物」软偏好铺面房名 |
| ③ | **`say` 按 `giver.tag` 分出 33 种口吻**（一两句，不写小作文） | `TAG_SAY[tag]`，33 个 tag 各一句 |
| ★ | **奖励数值 / id / name / `var` / 阶段结构 一律原样** | 只改 `desc`/`stages[].desc`/`targets[0].key`/`say.raw` |

**10 种模板的语义重写**（原模板把「人/地/物」的槽位混用，是串号的根）：送信→捎给关系人·送到其所在房；寻人→本城打听关系人；采买→本城铺面买齐·**交回给委托人本人**（原模板错写成交给"别人"）；采药→本城采三株草药；除害→本城除野兽；讨债→找欠债的人（`rel` 里有「仇」才点名）；寻物→本城找找；护送→护送货物到本城某处；打探→本城打听；了结→找那人理论（有「仇」才点名）。

## 4 · 改前 / 改后 对照统计

| 指标 | 改前（288 条） | 改后（262 条，另 26 已停用） |
|---|---|---|
| 目的地**跨 region** | **135** | **0** |
| 点名**张冠李戴**（不在 `rel`） | **4** | **0** |
| 点名人**跨区**（在 `rel` 却在别的 region） | **117** | **0** |
| `say` 文案**种类** | **1** | **33** |
| 含「多谢你了」的条数 | **288** | **0** |
| 两段 `desc` 组合**种类** | 284 | 257 |
| 任务总数 | 331 | **305**（＝331−26） |

## 5 · 抽查 10 条（改前 → 改后，原文）

> 覆盖 10 种模板各一条；`│` 后接收尾 `say`。

| # | 类型 / NPC | 改前 | 改后（原文） |
|---|---|---|---|
| 1 | **送信** `sq_npcv_019` 邹南枝(palace)@皇城·御道 | 「把信送到**任红**手上」→ go `palace_road` | 「邹南枝托你把一封信捎给**城里的旧相识**」「把信送到**皇城·天牢**」│ 邹南枝压低了声：「宫里的事，少问。」 |
| 2 | **寻人** `sq_npcv_020` 韩婉如(consort)@皇城·西六宫 | 「在**凤初霁**一带打听消息」 | 「去**皇城·午门**打听**凤初霁**的消息」│ 韩婉如掩唇一笑：「你倒是个伶俐的。」 |
| 3 | **采买** `sq_npcv_001` 许停(commoner)@江南城·市集 | 「把东西交回给**喜儿**」→ go `jiangnan_market` | 「去**江南城·柳巷**买齐日用杂货」「把东西交回给**许停**」│ 许停点点头：「劳烦你了。」 |
| 4 | **采药** `sq_npcv_002` 鲍立(vendor)@江南城·市集 | 「去山里采三株**昝秋**」→ go `shaolin_cangjing`（少林！） | 「去**钱府·后花园**采三株**草药**」│ 鲍立把担子往肩上挪了挪：「下回买我的货，算你便宜些。」 |
| 5 | **除害** `sq_npcv_003` 昝秋(scholar)@少林·藏经阁 | 「**杀掉鲍立**」→ go `jiangnan_market`（跨区） | 「近来**少林·天王殿**一带有野兽作乱」「去少林·天王殿除掉作乱的野兽」│ 昝秋拱手：「有劳。这份情我记着。」 |
| 6 | **讨债** `sq_npcv_004` 柯修(farmer)@城东·稻田 | 「找到欠债的**孔拾月**」→ go `emei_qingyin` | 「去**城东·佃户家**找着欠债的人」「把债讨回来交给**柯修**」│ 柯修搓着泥手：「乡下没什么好谢的，这筐菜你拿着。」 |
| 7 | **寻物** `sq_npcv_005` 伍修(smith)@少林·练武场 | 「在**谢时雨**附近找找」 | 「去**少林·大雄宝殿**附近找找」│ 伍修「叮当」一声又抡起锤：「记你的情。」 |
| 8 | **护送** `sq_npcv_006` 许清(doctor)@江南城·市集 | 「护送到**阿福**」→ go `taohuadao_qingyin`（桃花岛） | 「把这趟货护送到**钱府·后花园**」│ 许清收拾着药箱：「日后有个头疼脑热，尽管来找我。」 |
| 9 | **打探** `sq_npcv_007` 方初(innkeeper)@江南城·悦来客栈 | 「去**强弘**打听」→ go `jiangnan_inn` | 「去**江南城·钱府**打听」│ 方初撩起柜台布帘：「回头给你留间上房。」 |
| 10 | **了结** `sq_npcv_008` 强弘(waiter)@江南城·悦来客栈 | 「教训**秦湘**」→ go `wudang_jinding`（武当金顶） | 「去**江南城·长街**找那人理论」│ 强弘擦着桌沿：「多谢客官。」 |

**读一遍就能看出**：改后每条的目标人/目标地**都在委托人自己的生活圈里**、文案**各不相同**、并且**都收口在委托人本人身上**（采买/采药/寻物是「交回给委托人」）。**不是换个模板继续套**。

## 6 · E4：摘掉第一幕的「假结局」

**位置**：`60_quests.json` 的 `q_main_jianghu.rewards`（改前 :1154–1160）。

**改法**（照 `design/21` §9-E4 原样）：
```json
// 删：
{ "type": "ending", "args": ["jianghu_end", "江湖路远"] }
// 改为：
{ "type": "narrate", "raw": "江湖很大。你只是刚学会怎么在里头站住。" }
```
改后 `q_main_jianghu.rewards` 的类型序列：`+exp,+pot,+title,**narrate**,say,flag,narrate,+item,quest`（全库 `type:"ending"` 效果数 **0**，终章改由第五幕 `q_main_end` 的 `menu` 产出，属 E16）。

**⚠️ 依赖顺序（本批**只摘 ending**，**未动 rewards 搬迁**）**：
`design/21` §2.9.1 要求 —— 把「绝顶内功」门槛后移（C3）**必须同时**把「发铜牌 `depot_token_half` + `know_east_depot` + 接二幕」从 `q_main_jianghu.rewards`**搬到一幕夜戏的 action**里。但**一幕夜戏 action 属于 E6**（`road_huashan_1` 新增 action），**本批尚未落地**（本批 `q_main_jianghu.rewards` 里 `know_east_depot` / `depot_token_half` / `quest q_main_sect` 三条**原样保留**）。
**⇒ 正确的拆法**：**摘 `ending` 可以独立先做**（它与门槛/rewards 无耦合，是纯粹的「假终章」）；**rewards 搬迁必须等 E6**（否则铜牌会**两头都发**或**两头都不发**）。本批据此**只做前者**，后者留 E5/E6。

**连带登记（未改，避免越界，交后续）**：`achievements.jianghu_end`（`cond: {flag:"ending_jianghu_end"}`）在摘掉 ending 后成了**死成就**（`ending_jianghu_end` 再不会被置位）。建议由 E16 一并改判到 `act5_done` 或三结局 flag。

## 7 · 测试：`tools/smoke-quest-data.js`（新建 · **20 断言**）

| 段 | 断言 |
|---|---|
| ① 停用 | 26 条已移除 · 其余 262 条仍在 · 总数＝305 · 26 条 id 无悬空引用（60_quests 内） |
| ② 同区 | 目的地房间全在 · **0 条跨区** · 不落在 giver 自己房间 |
| ③ 点名 | 262 条点名之人**全 ∈ `rel`**（用「非 giver 全名子串」口径，避免「麻灵犀↔麻灵」误判） |
| ④ 文案 | `say` 种类 ≥10（实测 33）· 「多谢你了」＝0 |
| ⑤ 原样 | id / 两段结构（next 1→99）· `targets[0].kind=room/count=1/var=sq_XXX_go` + `cond.var` 未变 · 奖励结构（`+exp/+pot/favor[指向giver]/say`）完整 |
| ⑥ E4 静 | 无 `ending` 效果 · 有「江湖很大」`narrate` · 连带三项仍在 rewards（归 E5/E6） |
| ⑦ E4 动 | **走完第一幕（真实引擎 `交任务` 逐 stage 0→99）后无任何 `ending_*`** · 幕末收到新 `narrate` 而非「故事终章」· 换种子复测仍无 |

全部走真实路径 `new GameEngine({seed}).boot().newGame()`（不是 `new World()` 空壳）；`q_main_jianghu` 五道 stage `cond` 均按真实条件满足（拜师 / 武学100 / 支线5桩 / 击败名宿 / 绝顶内功），逐段 `交任务` 直到 99。**无恒真断言**。

## 8 · 变异自证（**先确认缺陷复现，再判红绿**）

用临时施加器 `tools/_mut-quest.js`（`apply` 后 `grep` 校验 marker 真进文件；`e4-ending` 额外**实跑第一幕**确认缺陷真的复现；`restore` 后 `cmp` 逐字节一致）：

| 变异 | 改动 | 缺陷是否真复现 | 实测红项 | 还原 |
|---|---|---|---|---|
| `e4-ending` | 把 `ending: jianghu_end` 插回 `q_main_jianghu.rewards` | **是**（走完一幕实产生 `["ending_jianghu_end"]`） | **3 红**（无 ending / 走完无 ending_* / 换种子）17/3，exit=1 | cmp ✔ |
| `b20-crossregion` | `sq_npcv_001` 目的地改回 `emei_qingyin` | **是**（跨区 1） | **1 红**（0 条跨区）19/1，exit=1 | cmp ✔ |
| `b20-badname` | `sq_npcv_001` 第 2 段改回「交给**史倦客**」 | **是**（越界 `npcv_274:史倦客`） | **1 红**（点名全 ∈ rel）19/1，exit=1 | cmp ✔ |
| `b20-saydup` | 262 条 `say` 全改回「多谢你了」 | **是**（种类 1） | **2 红**（种类≥10 / 无「多谢你了」）18/2，exit=1 | cmp ✔ |

**关键一条**：E4 的「第一幕无 `ending_*`」断言——**对改前的数据就是红的**（变异 `e4-ending` 已如实复现：走完一幕真产生 `ending_jianghu_end`）。**先红后绿**成立：它守得住这个 bug，不是假绿。
四组变异还原后 md5 回到 `fd8c5159…`（逐字节一致），无 `.mutbak` 残留。

## 9 · 回归数字 + 前后 md5

- **动手前** `game/data/60_quests.json` md5：`a9c3349426a37a74433372f6e91e0b12`
- **改完后** md5：`fd8c51590b8ce8453bd6069a038b1971`（LF + 2 空格缩进 + 结尾换行；`JSON.stringify(parsed,null,2)+'\n'` **逐字节等于**文件，未重排）
- `git diff --stat`：`1442 insertions(+), 2901 deletions(-)`（＝262 条文本重写 ± 26 条移除，**与改动量相称**，无整文件重排）
- **全量 `tools/smoke-*.js` = 33 套**：**32 套 exit=0、零 ✘**（含新增 `smoke-quest-data` **20/0**）。
  - ⚠️ **1 套红**：`tools/smoke-npc-skills.js` **exit=1 / 5 ✘** —— **属并行任务 eng-b8（B8 NPC 功法 / B17/B18/B19）进行中的红项**（它不读 `60_quests.json`；红项为「全库 NPC 数 333≠329」「货郎使江湖长拳」「东方不败招牌」「冯保使绣春刀法」「三个内侍/女官文案」）。**非本次引入，记录在案，不去改。**
- 关重点保住：`smoke-mainline` **0✘** · `smoke-act2` **0✘** · `smoke-social` **0✘** · `smoke-saveload` **0✘**。地图类 `map-check` **6492/0**、`mapguide-check`/`e2e`/`ui-bind-check`/`identity-check` 均 exit=0 零 ✘。
- `game/src/**` **零改动**；两份 `ui.js` **未动**。

## 10 · 改动文件清单 / 遗留

**改动文件**：

| 文件 | 改动 |
|---|---|
| `game/data/60_quests.json` | **唯一数据改动**：288 条 `sq_npcv_*` → 移除 26 + 重写 262；`q_main_jianghu.rewards` 摘 `ending` 换 `narrate`。id/var/rewards 数值 未动。 |
| `tools/gen-quests-b20.js` | 新建（262 条重写的确定性生成器，可复跑） |
| `tools/smoke-quest-data.js` | 新建（回归测试，20 断言，含 E4 专项） |
| `tools/_mut-quest.js` | 新建（**临时**变异施加器，供 §8 自证；非交付、可删） |
| `design/12-owner-bug-list.md` | B20 → ✅；新增 E4 条目 |
| `design/13-owner-bug-fix-report.md` | 本「批次 6」章节 |

**未改**：`40_npcs.json`（eng-b8 工作区）· `50_map.json` · `game/src/**` · 两份 `ui.js` · 其它 smoke。

**遗留 / 需知会**：

1. **`hk_*` 支线尚未存在**：`60_quests.json` 里 `hk_*` 前缀 **0 条**；`design/23` 的 52 条 `hk_*` 支线（26 人 × 2）**是另一批工程**。本批只做「**停用旧模板**」这一半；**「启用 hk_*」那一半需它落地时补**（涉及新增房间 `gusu_fengqiao`/`jn_granary`/`jn_yizhuang` + 物品 + 房间 action，均不在本批范围）。
2. **NPC 侧 `sidequest` 待重指**：26 位 NPC 的 `def.sidequest` 仍指向已移除的 `sq_npcv_XXX`（`40_npcs.json` 属 eng-b8 工作区，本批未碰）。`hk_*` 落地时须改指 hk id；或挂钩代码按「quest 不存在」跳过。
3. **`sidequest` 字段是「死字段」**（更大范围的观察）：全仓**无任何代码读 `sidequest`**（`def.quests` 仅 14 个手工 NPC 有）。即这批模板支线**当前根本没有挂载入口**，只能 `accept <名>` 接取。这是**先于**本 bug 的既有事实，登记备查（是否要「让 `sidequest` 生效」属独立决策，不在本批）。
4. **`say` 口吻按 `giver.tag`**：若某 NPC 的 `tag` 本身错挂（B17 嫔妃落黑木崖 / B18 内侍 gender 等并行任务在修），其杂务收尾口吻会**随之偏移**（如「压低了声：宫里的事，少问」）。这是「按 tag 分口吻」的既定代价，tag 修好后自动对齐。
5. **`achievements.jianghu_end` 成死成就**（见 §6 尾注），建议 E16 一并改判。
6. **未 `git commit`**：所有改动留在工作区，等主人审批。

---
---

# 批次 6 · B8（NPC 功法分配）+ B17 / B18 / B19

> 主人原报（bug 第 8 条）：
> 「为什么几乎所有 npc 都只会基本功法？为什么都只会基本拳脚棍法刀法这些，
> 都不会内功轻功招架之类的其他功法？**可以在写完地图分配与 npc 画像后再写 npc 会的功法。**」
> 前置：B13 地图分配已落地、A 层 26 张画像已灌入 → **B8 正式开工**。
> 交付人：eng-b8（工程半边）。设计半边见 `design/26-npc-skill-map.md`（文策渊 #24，与本批同日落地）。

## 1. 现象与根因

| 项 | 实测（`40_npcs.json`，B8 前） |
|---|---|
| `npcv_*` 程序生成 NPC 的攻击槽 | **219 / 265 挂在 `basic_*`**（基本拳脚/棍法/刀法）——正是主人报的「只会基本功法」 |
| `内功 / 轻功 / 招架` 三槽覆盖 | 仅 **43 / 69 / 26**（329 人里绝大多数一个都没有——主人报的「不会内功轻功招架」） |
| 僧/道 | 多数只有 `拳=basic_fist` 或 `内功=basic_force`，**没有身份功法** |

**根因**：`gen-social.js` 生成这批 NPC 时只按 tag 给了最粗的 `basic_*`，**从没做「身份 → 功法」的分配**；
且现有 53 门功法里**除 8 门 `basic_*` 外全是门派/传奇专属**，无门无派的武人（游侠剑客/镖师/江湖刀客/护院）
**根本没有可挂的「江湖通用」功法**——只能退回 `basic_*`。

## 2. 落地方式：**数据侧**（为什么不是像 B3 那样运行时注入）

任务书给了两条路（a 数据侧 / b 代码侧，参考 B3 的 `bestiary.js + applySpeciesMoves`）。**选 (a) 数据侧**，理由：

1. **并发隔离**：B3 的运行时注入必须挂 `world.js` 的加载路径（`applySpeciesMoves` 那两处），
   而 `world.js` 此刻正被另一名工程同事修「读档软锁」缺陷——**本批不碰共线文件**，零冲突；
2. **无「三条路径」隐患**：B3 自己注释过「同一个动作有三条加载路径（boot/reload/deserialize）」，
   数据侧落回模板后由 `Character` 构造时统一读取，**没有路径可漏**；
3. **一次改完**：本批本来就要动 `40_npcs.json`（B17/B18 两条数据错配），一个文件只改一遍；
4. **沿用既定管线**：`gen-portraits.js`（批次 5 画像落地）已立下「规则表 → 生成器 → 落回 `40_npcs.json`」的先例；
5. **可查可断言**：「谁会什么」在 JSON 里一目了然，回归可直接断言。

规则表结构**与 B3 同源**（`tools/npc-skills.js`：`ID_OVERRIDES` / `SECT_PLANS` / `TAG_PLANS` 三级，逐条列 id/tag，
**无任何「拿描述关键词猜」的判据**）；只是落地时机从「运行时」改成「生成期」。

## 3. 新增 7 门「江湖通用」功法（`10_skills.json`，53 → 60）

| id | 名 | 系 | category | dmg | 为什么必须新增 |
|---|---|---|---|---|---|
| `jh_fist` | 长拳 | 拳 | 外功 | 1.05 | 现有「拳」非 basic 的只有少林/武当/传奇招，市井护院无从可挂 |
| `jh_sword` | 江湖剑法 | 剑 | 外功 | 1.08 | 现有剑法全是门派招牌（华山/峨眉/太极…），非门派剑客无从可挂 |
| `jh_blade` | 江湖刀法 | 刀 | 外功 | 1.10 | 狂风快刀/胡家刀法偏**专**（快刀、胡家），市井刀客要一档通用 |
| `jh_staff` | 齐眉棍法 | 棍 | 外功 | 1.06 | 棍法只有丐帮打狗棒 + 皇家圣旨纶音，艄公/马夫/农户无从可挂 |
| `jh_parry` | 卸力招架 | 招架 | 外功 | 0 | **现有招架只有 `basic_parry` 一门**（主人点名「不会招架」） |
| `jh_dodge` | 轻身术 | 轻功 | 外功 | 0 | 现有轻功 4 门全门派，非门派贼/舞伎无从可挂（主人点名「不会轻功」） |
| `jh_neigong` | 吐纳功 | 内功 | 内功 | 0 | 现有内功 6 门全门派/传奇，非门派武人无从挂（主人点名「不会内功」） |

> **数值刻意贴近 `basic_*`**（只高 0.05~0.10，mp 耗 0~4）——目的是**换身份、不抬输出**。
> 命名走「江湖通用」语域，与门派招牌在战斗日志里一眼分得开。

## 4. 身份 → 功法映射表（`tools/npc-skills.js` 的规则表）

判据优先级：**具名/守卫 id → `sect` → `tag`**（全部显式字段，不猜）。

**4.1 职业武人（按身份定兵刃系）**

| tag | 攻击槽 | 支持槽 | 依据 |
|---|---|---|---|
| `swordsman` 剑客 | `剑=jh_sword` | 轻功 + 招架 + 内功 | 主人「剑客用剑法」 |
| `escort` 镖师 | `刀=jh_blade/hujia_daofa/kuangfeng_daofa` | 招架 + 轻功 | 主人「刀客用刀法」 |
| `constable` 捕快 | `刀=jh_blade/kuangfeng_daofa` | 招架 | 公门配刀 |
| `hunter` 猎户 | `刀=hujia_daofa/jh_blade` | 轻功 | 山行佩刀 |
| `monk` 僧 | `拳=jh_fist` | **内功 + 招架 + 轻功** | 主人「和尚用内功轻功，不是拿刀砍」 |
| `nun` 尼 | `拳=jh_fist` | **内功 + 轻功** | 同上 |
| `taoist` 道 | `剑=jh_sword` | **内功 + 轻功** | 同上 |
| `beggar` 丐 | `棍=jh_staff` | 轻功 + 内功 | 乞丐用打狗棒/齐眉棍 |
| `thief` 贼 | `拳=jh_fist` | **轻功** | 贼重身法 |
| `smith` 铁匠 | 按现有系（`刀`/`拳`）升级 | 招架 | 铁匠使手里那把 |
| `doctor` 大夫 | `拳=jh_fist` | 内功 + 招架 | 医者内息 |

**4.2 非武人（保留原兵刃系 + 一门护身招架 / 轻功）**

`palace/conso rt/courtesan/singer/actor/madam` → 原样系 + **轻功 `jh_dodge`**；
`commoner/farmer/vendor/merchant/richman/innkeeper/waiter/waiter2/groom/boatman/refugee` → 原样系 + **招架 `jh_parry`**（船夫/马夫另加轻功）；
`eunuch` 内侍 → `拳=jh_fist` + 招架。
**`scholar` 书生：只按系升级拳脚，`support` 为空 —— 绝不配内功**（主人在报告里点名「给书生发内功」是误配）。
`child` 孩童：不配支持槽。

**4.3 门派（`SECT_PLANS`，优先级高于 tag）**

11 个有成员的门派（华山/少林/武当/峨眉/丐帮/魔教/桃花/苗疆/大理/血刀/星宿）各取其**门派功法数组**
（`30_sects.json` 的 `skills`）作攻击槽，缺的支持槽补门派轻功/内功/招架。**已有真功夫的槽一律保留**（只加不夺）。

**4.4 具名 / 守卫（`ID_OVERRIDES`，逐条列 id）**

`guard_city`（剑）· `guard_palace`（棍）· `guard_yamen`（刀）· `guard_jinywei`（绣春刀）·
`guard_shaolin`（罗汉拳+内功）· `guard_huashan`（华山剑法）· `guard_blulu`（拳，文职）·
`mob_bandit`（刀）· `mob_bandit_chief`（胡家刀法）· `mob_soldier`（棍+招架）· `mob_assassin`（暗器+轻功）· `mob_mo_disciple`（黑幕掌）。

**4.5 覆盖**

- 落功法 **300 / 329** 条；**未覆盖 5 条**＝5 只兽（`mob_wolf/boar/snake/black_bear/tiger`）——**兽类属 B3 的 `speciesMoves` 领地，本批明确放手**（`SKIP_IDS`）。
- `js` 其余 24 条「判出身份但无需改动」＝13 名原著名宿 + 11 名已是正确配置者（`applyPlan` 只加不夺，故 0 改动）。

## 5. 误判防护（B3 的 BLK-2 教训，逐条落实）

B3 曾因「desc 里出现『蛇』字就判物种」把人类剑客蓝凤凰误判成蛇。B8 面对 **329 个人类**，误判代价更大，故：

1. **判据只用显式字段**：`id`（逐条列）/ `sect` / `tag`——**绝不读 `name`/`desc`/`title` 里的任何词**（全函数无正则扫文本）；
2. **只加不夺**：槽里已是**非 basic 真功夫**就**原样保留**（手写作者意图优先），只升 `basic_*`、补缺的支持槽；
   **不删除任何既有 `skills`/`learned`/`teach`/字段**（深比对确认 `fields removed: 0`）；
3. **判不出就不动**：`tag` 认不出的模板返回 `null`（兽类即走这条），零影响；
4. **反例钉死**：`smoke-npc-skills.js` 显式断言「僧人不使刀法」「书生不被配内功」「不跨槽（鞭/枪/音波 不新增）」。

## 6. 兵刃绑定·同类排查（**本批发现的既有缺陷，一并修**）

`combat.weaponPenalty` 对「兵刃系招式 + 没有对应兵刃」打 **0.45 折 + 日志「手中无X类兵刃，威力大减」**
（B3 在动物招式上专门绕开过这个坑）。**全库实测 B8 前有 49 处这样的空装**
（山贼有刀法没刀、捕快拿**枪**使刀法、黄药师有狂风快刀没刀…）。
处理：给「有兵刃系招式」的 NPC 补/换一把**最普通、几乎不加成**的兵刃（`wood_sword`+3 / `butcher_knife`+0 / `wood_staff`+10），
其中 5 席「手里只有**枪**」（`WEAPON_REQUIRED` 无枪键、也无枪类招式，装了必吃惩罚）换成同身份的普通刀。
**结果：49 处 → 5 处**（余 5 处是「暗器/音波」——全库**无这两种兵器道具**，无法满足，登记备查）。
`equipment` 变动 **60 席**（57 补、5 换枪；其中 47 席是新建 `equipment` 字段）。

## 7. A 层 Boss 专属招式清单（有辨识度，非「高级版基本拳法」）

15 位 A 层名宿**全部**持有非基本招牌（`smoke-npc-skills` 断言）：

| Boss | 招牌招式 | 备注 |
|---|---|---|
| 岳不群 / 岳灵珊 / 令狐冲 | 华山剑法·剑意 | 保留（原已正确） |
| 方证大师 | 韦陀掌 + 易筋经 + 罗汉拳招架 | 保留 |
| 冲虚道长 | 太极剑法 + 纯阳无极功 + 梯云纵 + **太极拳（补挂）** | `learned` 早有太极，本批补上槽 |
| 灭绝师太 | 峨眉剑法 + 佛光普照 | 保留 |
| 洪七公 | 降龙十八掌 + 打狗棒法 + 逍遥游 | 保留 |
| 东方不败 | **辟邪剑法（一阶段）** + 黑幕掌 + 吸星大法 | 保留（`bossPhases` 三阶段） |
| 黄药师 | 狂风快刀 + 一阳指 | 保留（原缺刀→本批补 butcher_knife，招式才真正生效） |
| 蓝凤凰 | 苗疆蛊术 + 冰蚕掌 | 保留 |
| 段誉 | 北冥神功 + 凌波微步 + 一阳指 | 保留 |
| 血刀老祖 | 血刀刀法 | 保留 |
| 丁春秋 | 摧心掌 + 唐门毒术 | 保留 |
| 冯保（东厂提督） | 绣春刀法 / 影卫 / 圣旨纶音 | 保留（三阶段） |
| 影子（影卫首领） | 影分身 | 保留（两阶段） |
| **15 位 A 层故事人物（npcv_）** | 黄望舒→打狗棒法·蒋停舟→玄铁剑法·任停→韦陀掌·邵清欢→胡家刀法·屈弘→江湖剑法+吐纳功·元若→齐眉棍法·强秋→狂风快刀·庞听→长拳·黄清→狂风快刀·梅拾→长拳·药婆婆→长拳…… | **本批新配**（原来只有 `basic_*`） |

## 8. B17 / B18 / B19 判据与处置

### B17 · 嫔妃落黑木崖（4 席）→ **改落点**
- **根因（查实）**：`gen-social.js` 的 `placeFor` 用房间**名**里的 `/宫|殿|苑|御/` 判「是不是宫室」——
  `黑木崖·大殿` 含「**殿**」被误判成 palace，于是 `consort` 被排进去。（同坑还造成：`少林·大雄宝殿` 排进 4 名内侍、`武当·紫霄宫` 排进 4 名宫中内人。）
- **判据（为什么改落点不改 tag）**：① `consort`＝嫔妃＝**宫廷位分**（`title` 明写「嫔妃」），另有 5 位同 tag 嫔妃本就在 `palace_court2`；② 「与黑木崖一致」的那些字段（`district/province/neighbors`/4 张 C 层画像）**全部是落点错误的下游产物**（画像作者自己在 `npcv_053._note` 里写了「落点错配…在像内圆场」）；③ 改 tag 需找一个「魔教女眷」身份，而**33 个 tag 里没有**——错的是落点不是 tag。
- **处置**：`room→palace_court2`、`district→palace`、`province→京畿道`、`neighbors` 换新邻居；
  **4 张 C 层画像同步回改**（`design/portraits-batch-c.json` 的 `role/now/marks`，`教`→`宫`）——与设计稿 `26-npc-skill-map.md §7.2` **结论一致**。

### B18 · 内侍 gender 与 tag 矛盾（5 席）→ **改 gender（female→male）**
- **根因（查实）**：`gen-social.js:380-381` 的性别规则——`['courtesan','singer','consort','palace','nun','madam'].includes(tag) ? 'female' : 随机`
  ——**`eunuch` 不在强制为男的白名单里**，10 个内侍随机出了 5 个 female。（`monk` 同病，另有 4 个女「和尚」，不属本批，登记。）
- **判据（为什么改 gender 不改 tag）**：① 「内侍/太监」**定义上只有男性**（tag 与 title 都写「内侍」），女内侍语义不成立；② 女性化 `desc`（耳坠/辫子/帔子）与画像「她」**是从 gender 生成的**（循环证据，非独立佐证）；③ tag 是**结构性分配**——`eunuch` 恰好 9 席、与 C 层批次设计（`15-portrait-roster §5.4`「内侍9」）**完全对上**，说明 tag 对、gender 错。
- **处置**：**只改 `gender`**（5 席 female→male），**`tag`/`title`/`room` 一律不动**（依「不许两边都改」）；
  由 gender 派生的 `desc` 与画像 `now`（「她」）**一并对齐**为男内侍口径。
- ⚠️ **与设计稿的分歧（请主理人知会）**：`26-npc-skill-map.md §7.1` 建议**改 tag（eunuch→palace）保留 female**，本工程**未采纳**——
  依据是上面第 ③ 条查实的**生成器根因**（gender 才是被随机写错的那一边），且改 tag 会让 `title`「内侍」与画像口吻继续打架。
  **此处工程与设计不一致，列在 §10 冲突清单**，供裁决。

### B19 · 人数口径（4 / 4 vs 「三个」）→ **改文案**
- ⚠️ **查实：任务书与设计稿引用的「主线文案写『三个』」那一行，在仓库里不存在。**
  已穷尽核查 `design/10-mainline-story.md`、`21`、`24`、全部 `design/*.md`、`game/data/*.json`——
  **`10-mainline-story.md` 第二幕 2-3 原文是「冲虚让你去**两处**：少林问方证…黑木崖探虚实」，无「三个女官」字样**；
  全仓「三个…内侍/女官」只出现在 **bug 台账（`12`）与设计稿（`26`）里对这条问题的引述**，不是主线正文。
- **处置**：既然没有错误文案可改，改为**写入权威口径 + 加护栏**：
  ① `design/10-mainline-story.md` 第二幕末追加一条**「人数口径校正」**（宫中女官 **4 人** / 内侍 **4 人**，凡文案一律写「四个」，
     并点明「冲虚 3 条 `仇` 是**关系边**数，不是 NPC 人数」）；
  ② `design/21-mainline-act3-5.md §5.7` 补两行（武当 4 女官 / 少林 4 内侍）；
  ③ `smoke-npc-skills.js` 加断言：**正式文案里不得出现「三个内侍/女官」**，且 10-mainline-story 已含「四个」口径。

## 9. 测试 + 变异自证 + 回归

**新增 `tools/smoke-npc-skills.js`（47 项，全绿）** —— 四组：
① 身份映射（僧道内功/轻功、僧人不使刀、书生不配内功、刀/剑人手规模）；
② 硬不变量（**每个兵刃系招式必有对应兵刃**、每个槽技能必挂 learned、无悬空引用）；
③ **真打真看**（真 `GameEngine.boot().newGame()` + 真 `combat.step`，从日志数招式名）：
   和尚→`韦陀掌`、镖师→`狂风快刀`、剑客→`江湖剑法`、老叫花→`打狗棒法`、货郎→`长拳`、东方不败→`辟邪剑法`、冯保→`绣春刀法`；
   并断言 **NPC 侧不再出现「手中无X类兵刃」**；
④ A 层招牌 + 同类身份多样性 + B17/B18/B19 + 伤害有限性。

**变异自证（先确认缺陷复现，再判红绿）**：

| 变异 | 复现（先确认） | 结果 |
|---|---|---|
| ① 让 `planForNpc()` 恒返回 null（＝B8 未做） | 日志实测**基本拳脚/基本刀法**、49 处空装、24 条「手中无兵刃」 | **36 通过 / 11 失败** |
| ② B17 四位嫔妃 `room` 改回 `mojiao_hall` | 复现「mojiao_hall 有 4 嫔妃」 | **43 / 4 失败** |
| ③ B18 五位内侍 `gender` 改回 female | 复现「eunuch 里 5 个 female」 | **45 / 2 失败** |
| 还原 | — | **47 / 0 全绿** |

**回归（批次 6 后，2026-10-11）**：全量 **34 套** `tools/smoke-*.js` **全 exit=0、零 ✘**；
`map-check` **6492/0** · `mapguide-check` **72/0** · `e2e` **122/0** · `identity-check` **48/0**；
8 个 UI check（martial/look-detail/ui-bind/game-ui/dom-page/account/input-guard/kidnap-ui）**全 0 失败**。
数据文件格式闸门：`40_npcs.json` 逐字节可还原（1 空格缩进）；`10_skills.json`（2 空格 + 尾换行）可还原。
`git diff` 除本批 3 文件外未动 `game/src/**`、两份 `ui.js`。

## 10. 交付物 / 未改 / 遗留

**新增**：`tools/npc-skills.js`（身份规则表）· `tools/gen-npc-skills.js`（生成器，幂等，带 `--check`）·
`tools/fix-b17-b18.js`（B17/B18 数据修正器）· `tools/smoke-npc-skills.js`（47 项）。
**改动**：`game/data/10_skills.json`（+7 功法）· `game/data/40_npcs.json`（skills 300 / learned 299 / equipment 60 / gender 5 / desc 5 / room·district·province·neighbors 各 4）·
`design/portraits-batch-c.json`（4 嫔妃画像回改 + 2 内侍代词）· `design/10-mainline-story.md`、`21`（B19 口径）· 本报告 + `12-owner-bug-list.md`。

**与设计稿 `26-npc-skill-map.md` 的差异（照实列，供裁决）**：

| # | 点 | 设计稿（26） | 本工程实做 | 说明 |
|---|---|---|---|---|
| 1 | **B18** | 改 tag（eunuch→palace），保留 female | **改 gender（→male）** | 工程查到生成器根因（gender 被随机写错）→ 判定 gender 才是错边；见 §8。**分歧待裁决** |
| 2 | **C 层是否动** | 「C＝只挂 `basic_*`，建议不动」 | **C 层也补**（支持槽 + 系升级） | 主人报的是「**几乎所有** NPC」——C 层 89 人正是「几乎」的一部分；且补的都是**低熟练度**，不抬输出 |
| 3 | **新增功法** | 建议 4 门本职（`constable_cudgel`/`hunter_bow`/`medicine_needle`/`boat_pole`） | 增 7 门**通用**（`jh_*`） | 本职功法只能覆盖单身份；通用功法让**所有**非门派武人都有可挂的中阶档，且不动槽位语义（未采纳 `sing_wave` 新槽位） |
| 4 | **A/B 分层判据** | 用 `rank`（门派职级）判绝学/中阶 | 用 `tier` 定支持功法熟练度档位 | 本批**不挂绝学**（绝学一律保原状），故与 `rank` 口径不冲突；熟练度只影响属性加成 |
| 5 | **捕快越派 `kuangfeng_daofa`** | 建议清洗为 `basic_blade` | **保留**（只加不夺） | 属既有数据，本批不擅动；已登记 |
| 6 | **`official` 挂 `huashan_sword`** | 别洗（与人设咬合） | **保留** | 一致 |

**发现的既有缺陷（非本批引入，登记备查）**：
1. **`gen-social.js` 的性别规则漏了 `eunuch`（还有 `monk`）** → 会再生成女内侍/女和尚。建议给生成器补白名单（本批未改生成器）。
2. **`gen-social.js` 的 `placeFor` 用房间名关键词判宫室** → 任何含「殿/宫」的房间（含少林大雄宝殿、武当紫霄宫、魔教大殿）都会被当成 palace。B17 只修了嫔妃一处；武当/少室的同类落点 B19 认定**非错配**，保留。
3. **暗器 / 音波无对应兵器道具** → 3 处暗器招式的武器惩罚无法消除。
4. **玩家开局**：`startItems` 有 `wood_sword` 但**未装备**，而 `equippedSkills['剑']=basic_sword` → 开局使剑会吃「手中无剑类兵刃」惩罚，直到玩家自己 `装备 木剑`。不属 B8，登记。
5. 另有既有悬空引用：`guard_palace::身体=armor_leather`、8 个 NPC 的 `carry` 含 `herb_lingzhi`/`herb_ginseng`/`candied_fruit`/`mooncake`（物品表里没有）。本批只清了 `guard_palace` 的 `gunfa_basic`（技能）与 `spear_iron`（兵器）。

**未做**：`git commit`（留工作区等审批）· 未采纳设计稿的 4 门本职功法与 `sing_wave` 新槽位（如需，另批）。

---

# 批次 7 · 主理人亲做（2026-10-10 傍晚）

> 背景：本轮主人要求「发布 → 继续做 → 做完再发布」，并明确「接下来的问题你自己做决定」。
> 主理人把可机械验证、且不必等 agent 的三件事**自己动手做掉了**（当日已有 5 位队友因网络超时中断，
> 见 `design/29-day-overview.md`）。

## 7.1 B27 —— C 层 86 张画像落地（高）

**问题**：`design/portraits-batch-c.json` 的 86 张画像早已写完并通过校验，但**从未写进游戏**。
实测：游戏里只有 **42 张**画像（39 A + 3 B），**C 层 0 张** —— 也就是「众生」（乞丐/孩童/流民/平民/
嫔妃/宫人/内侍/青楼女子/乐伎/茶博士）在玩家眼里**还是一张白纸**。

**做法**：用项目已有的生成器，一行命令灌入，不另写脚本。
```bash
node tools/gen-portraits.js --file=design/portraits-batch-c.json --check   # 先校验：86 条全部合格
node tools/gen-portraits.js --file=design/portraits-batch-c.json          # 再写入
```
- 生成器自带：递归剥离 `_` 开头键（`_note`）/ 幂等（`v===1` 跳过）/ 写前逐条必填校验 / 失败拒绝落盘。
- 备份 `tools/_bak/40_npcs.pre-c-portraits.json`。

**结果**：画像 **42 → 128 张**（原 16 + A 层 26 + C 层 86）。
- `40_npcs.json` 原始口径：329 人 / 128 张（38.9%）
- `game/data/40_npcs.json` 写后**仍逐字节可被 `JSON.stringify(.,null,1)` 还原**（609,737 B）——
  这条是画像生成器幂等性与 `smoke-portrait-batch` 的前提，必须每次写后复核。
- 软提示 9 条（`marks:"童"` 不在名录 §5.2 词典），**不阻断**；属词典回填事项，已记在报告末尾。

## 7.2 新增功能 —— `quit` / 「退出游戏」

**需求（主人原话）**：「添加退出游戏指令 quit 以及对应中文『退出游戏』」。

**设计**：退出这件事**只能由界面完成**（后端最多回一句话，关不掉这一局），所以和「面板指令」同理，
走**前端本地拦截**；后端同时注册一份，供纯文本客户端 / mod 调用，并让 `help` 列得出来。

| 层 | 改动 |
|---|---|
| 后端 `game/src/core/commands.js` | 注册 `quit / exit / 退出游戏 / 退出 / 离开游戏 / 回主菜单`，返回 `{action:'quit', lines:[…]}`；`help` 的「系统」组加一行 |
| 前端 `ui.js`（两份副本） | `QUIT_CMDS` + `isQuitCmd()`；`doCmd()` 里本地拦截；新增 `quitGame()` |
| 前端 `ui.js` | 侧栏原有「返回主菜单」按钮**改为走同一条 `quitGame()`** |

**`quitGame()` 的三条规矩**（都是「别让玩家白玩」）：
1. **先问一句** —— 敲错一个字就退出，谁都要骂人；
2. **退出前先存档** —— 有人关掉了自动存档，不能因此丢进度；
3. **回主菜单后刷新「继续游戏」按钮** —— 否则刚退出就看不到自己的档，玩家会以为进度没了。
   另：**存档失败也必须能退出**（不能把人锁在游戏里），但提示走 `warn`、**不给「已保存」的假安心**。

**回归**：新建 `tools/smoke-quit.js` **23 通过 / 0 失败**，全部打在真实路径上
（真 `exec('quit')` / 真 `doCmd('退出游戏')` / 真点 `#cf-yes` / 真读 `#screen-start` 的 active 与 `api.save` 调用次数）。
含两条**防过头**的断言：B2「正常指令不被误拦」（`look/map/save/kill/退出登录` 都必须 false）、
C6「存档失败仍能退出、且不谎报已保存」。

## 7.3 B28 —— `smoke-portrait` 第⑤组断言**对象搞错**（中）

**现象**：灌入 C 层画像后 `smoke-portrait` 变红：`无画像 NPC 仍占绝大多数（画像只覆盖少数）195/333`。

**这不是回归，是断言本身写错了对象。** 该断言的**真实意图**（看它自己的注释）是
「第⑤组（无画像 NPC 不崩 / 无 undefined）要有**足够大的样本**」，但它写成了
「无画像的人要**占大多数**」。这一条历史被改过两次，**两次都是同一个错**：
- 最早写死 `noPortrait > 300` → 画像一多就假红（317→281 时炸过一次）；
- 改成比例 `> 全库 × 0.7` → 只是把假红**推迟**到覆盖率过半（195/333 = 58%）时。

**修法**：拆成两条互相独立的断言，各守一件事：
- `⑤-a 无画像 NPC 样本量够（≥50）` —— 守「第⑤组有意义」
- `⑤-b 画像数只增不减（≥128）` —— 守「谁把画像弄丢了必须红」

**变异自证（先确认缺陷复现再判红绿）**：从 NPC 列表**尾部**抹掉 20 张画像
（避开 §④ 点名的样本，以免更早的断言先崩、测不到 ⑤-b）：
`⑤-a 绿 / ⑤-b 红（127 通过 / 1 失败）` → 还原后 `128/0`，`40_npcs.json` md5 复原为 `595605002b…`。
⇒ 两条断言确实各测各的，不是互相顶替。

## 7.4 顺带核实（不改，只报告）

- **B17 已修**：4 位嫔妃（`npcv_053/119/185/251`）已从**黑木崖**（魔教总坛）迁到 `palace_court2`（皇城）✅
- **B18 已修**：9 个内侍的 tag 与 gender 不再矛盾（抽查 4 位均为 `tag=eunuch / gender=male`）✅
- **B26 遗留**：`wudang_zixiao` 4 位宫中女官 / `shaolin_daxiong` 4 位内侍，而主线文案写「三个」→ 测试
  `smoke-npc-skills` 已断言「正式文案里无『三个内侍/女官』的错误口径」，B19 应按 4 人走。
- **画像人数口径更正**：有画像 NPC 在引擎合并后为 **138 人**（`40_npcs.json` 内 128 人 + 已启用 mod 层若干），
  对外表述请以「**128 张画像（原始数据口径）**」为准，避免两处数字打架。
- **有画像者的武学核查（主人问的）**：遍历 128 位有画像 NPC，按 `portrait.role` / `job` / `title` /
  `portrait.now` 判定「身份像会武」者 —— **只有 `basic_*` 或无技能的数量 = 0**。
  ⇒ 有画像、且身份该会武的人，武学都配上了（B8 与画像**对得上**）。

---

# 批次 7b · 双端与 UI（电脑端 / 手机端完善 + 界面打磨）

> 交付人：工程负责人（程基岩 · `ui-polish`）｜ 2026-10-10
> 主人原话：「还有电脑端与手机端想想怎么完善一下，……界面 ui 完善一下」。
> 本节与上节「批次 7 · 主理人亲做」**并行**，只动 `game/src/renderer/**`、`server/public/js/ui.js`、
> `server/public/css/main.css` 与 `game/src/renderer/index.html`（版本戳）；**不碰 `game/src/core/**` 与 `game/data/*.json`**。

## 0 · 摘要

| 项 | 判定 | 一句话 |
|---|---|---|
| **B15** 前端性别硬编码 | 🔴 **还在 → 已修** | 改前 `ui.js` 仍有 **7 处** `gender === 'female' ? '女' : '男'` + 2 处写死「他」；已全部收敛进一个入口 |
| 手机端「别扭」 | 🟢 修 3 处 | ①窄屏**一个面板入口都没有**（含设置/存档/回主菜单）→ 补 ☰ 菜单；②弹窗 ✕ 只有 17px 字、点不准；③版本戳顺推 j→k |
| 电脑端「别扭」 | 🟢 修 1 处真 bug | **弹窗开着时按 w/a/s/d 会在弹窗背后偷偷走路**（数字键更隐蔽） |
| UI 打磨 | 🟢 3 个 CSS 变量 | `--gold-d` / `--jade-d` / `--ink-1` **从未定义**，用到它们的声明被整条丢弃 —— 其中一处让地图出口按钮 **hover 时白字发白** |
| 新测试 | 🟢 | `tools/smoke-uiux.js` **46 通过 / 0 失败**（真渲染 + 真点击 + 真键盘） |
| 变异自证 | 🟢 | **5 组，全部先确认「缺陷真的复现」再判红**，还原后 md5 复原 |
| 全量回归 | 🟢 | **36 套 `smoke-*.js` 全 `exit=0`、✘ 全 0**；7 套前端 `*-check` 全绿 |

---

## 1 · B15 —— 前端性别硬编码：**还在**（已修）

**核实（改前实测）**：`grep -n "female" game/src/renderer/js/ui.js` →
```
558:  场景栏 NPC 菜单头      n.gender === 'female' ? '女' : '男'   ← 主人实测：点毒蛇 → 「山中猛兽 · 男」
903/925/933/953/974:      婚配 / 妾室 / 结缘 / 义亲 / 此地可议
1065: 玩家自身状态面板「性别」
581/582: '送他东西' / '给他银钱' 菜单文案（写死「他」，对女 NPC 也显示「他」）
```
这正是批次 4 验收 §3.4 **CN-1** 登记的「同根因漏网点」——**未修**。

**改法**：在 `ui.js` 新增**唯一**的性别入口（`genderNoun()` / `pronounTA()`），7 处渲染点与 2 处菜单文案全部改走它。
- `genderNoun(x)`：`female→女 / male→男 / 其余（other·缺失）→不明`
  → 毒蛇（`gender:'other'`）现在显示「山中猛兽 · **不明**」，不再是「男」。
- `pronounTA(x)`：`female→她 / male→他 / 其余→TA`
  → 男 NPC 仍「送他东西」（**ui-bind-check 的 77 条断言原样不动、不绿变红**），女 NPC 改对成「送她东西」，兽用中性的「TA」（与仓里既有的「与 TA 结缘／结拜」同一写法，**不为兽生造「它」**）。

**为什么没有直接 `require('../../../core/pronouns.js')`**：前端运行在浏览器 / 测试 vm 里，**没有 `require`**；后端 NPC 视图当前只发 `gender` 的**原始值**、不发算好的名词。「一份实现」的正解是**后端把名词放进视图字段**，但那要改 `game/src/core/engine.js` —— **本轮并发边界明令不许碰 core**。故先在前端镜像同一判据（含注释指回真相源），并把「后端发名词、前端零逻辑」登记为后续（见 §9）。
> ⚠️ 铁律执行情况：改后 `ui.js` 里除 helper 自身与说明注释外，**再无一处** `female ? '女' : '男'` 渲染写法。

---

## 2 · 手机端问题清单与处置

| # | 玩家会遇到什么 | 处置 |
|---|---|---|
| M1 | **窄屏（≤820px）侧栏被 `display:none`，属性 / 装备 / 状态效果 / 人情往来 / 姻缘义亲 / 家宅 / 奴册 / 保存进度 / 设置 / 返回主菜单 在手机上「一个入口都没有」**；战斗态快捷条又被换成攻击键，**连背包都点不开**（触屏验收第 9 条因此必挂） | 在快捷条常驻一个 **☰ 菜单**（`openSideMenu`），点开就是侧栏那套面板/动作；**战斗态也在**（战斗里能开背包）。桌面端由 CSS 藏起来（`.qb-menu{display:none}`，≤820px 显形）——不在已定稿的桌面布局上加东西 |
| M2 | 弹窗右上角 ✕ 只有一个 17px 的字，**手指点不准**；底部「关 闭 / 确 定」按钮偏小 | 窄屏下面板头 ✕ 抬到 **≥40×40px 点击目标**，底部按钮加高内边距 |
| M3 | 手机上地图 / 面板都没超屏（`.modal` 88vh + `.modal-body` 可滚；地图 B14 已修） | **无需改**（复核通过） |
| M4 | 触屏输入法防弹（`blurCmdInput` / `isTouchDevice`）未坏 | **未动**（铁律 31：动 focus/blur 必写行为回归；本轮不碰，`input-guard-check` 19/0 原样） |
| M5 | 长日志流（每来一条日志 `paintLog` 会**整块重建** innerHTML）在低端机上可能卡 | 上限 600 行**已有**、自动滚底**已有**（本轮钉成断言）；「增量追加」属重构，**风险大、不改**，登记 §9 |

---

## 3 · 电脑端问题清单与处置

| # | 玩家会遇到什么 | 处置 |
|---|---|---|
| D1 | **开着「背包 / 地图 / 状态」等弹窗时，按 `w/a/s/d/q/e/z/c`（方向）或 `i`（背包）会在弹窗背后偷偷执行** —— 弹窗不关、日志在底下变，玩家以为只是翻页；按 `1~9` 还会走到**上一个房间**的出口（九宫格在弹窗后面的日志里） | `bindHotkeys` 加一道守卫：**弹窗 / 选择框开着时，方向与字母/数字快捷键一律不生效**（Esc 照旧关弹窗） |
| D2 | 宽屏三栏（侧栏 172 + 日志 + 场景 238）在 1920px 下日志行很长（无最大行宽） | **不改观感**（属排版取舍，改动会动到已定稿版式）。登记 §9，若要改建议单独一批 |
| D3 | 方向键 / 回车 / ↑↓ 翻历史 | 复核可用：`bindInput` 的 Enter/ArrowUp/ArrowDown/Escape 均正常；未坏，未动 |

---

## 4 · UI 打磨改动清单（每处理由）

| 改动 | 位置 | 理由（玩家会遇到什么） |
|---|---|---|
| 定义 `--gold-d: #8a6d1e` | `main.css :root` | 改前**从未定义**→ 4 处 `var(--gold-d)` 声明被**整条丢弃**。最严重的是地图出口按钮 `.exit-inline:hover{ background:var(--gold-d); color:#fff }` —— 底色没了，**白字落在浅色画布上 = 文字消失**；`.panel-sec` 小节标题也丢了金色。 |
| 定义 `--jade-d: #2c6b4d` | 同上 | 2 处 `var(--jade-d)`（激活天赋、已登录态）同样被丢弃；取值与仓里既有的 `.ra-btn` `#2c6b4d` 同色。 |
| 定义 `--ink-1: #1f1c17` | 同上 | 楔子强调句 `.intro-em` 的 `var(--ink-1)` 被丢弃（靠继承侥幸看得见，但语义错）。 |
| `.qb-menu`（☰）桌面隐藏 / 窄屏显形 | `main.css` | 手机端入口（M1），且**不打扰桌面**已定稿布局。 |
| 窄屏弹窗点击目标 ≥40px | `main.css @media(max-width:820px)` | M2：手指点得准。 |
| 性别名词统一入口 | `ui.js` | B15（§1）。 |
| 弹窗热键守卫 | `ui.js` | D1。 |
| 版本戳 `20261010j → 20261010k`（7 处） | `index.html` | 铁律 2：改了 CSS/JS 静态资源必须顺推，否则玩家跑缓存旧代码。 |

> **没有做**：任何版面重构、配色改动、字号体系调整、按钮形态重做。主人要的是「完善」，不是重做。

---

## 5 · 新增测试 `tools/smoke-uiux.js`（**46 断言**）

真渲染 + 真点击 + 真键盘（vm 载入真 `app.js`+`ui.js`，喂真 `GameEngine.view()`，照抄 `smoke-mapui.js` 的 DOM stub 三坑规避）：

| 组 | 内容 |
|---|---|
| §0（3） | 两份 `ui.js` / `main.css` 逐字节一致 + 版本戳 ≥7 处且统一 |
| §1（11） | **B15 真场景**：出生房里同框 一女（范清）一男（游侠）一兽（`mob_snake`，真 `spawnNpc`）→ 点三张卡片：兽→「不明」（且❌「男」）、女→「女」、男→「男」；文案 她/他/TA；末条真点菜单「查看」→ 真派发 `look 毒蛇` |
| §2（5） | 性别入口喂真实调用路径入参：姻缘面板（妾室 `gender:'other'`）→「不明」、状态面板（玩家 `other`）→「不明」、不出现 `undefined` |
| §3（10） | **CSS 契约**：`main.css`（两份）里 `var()` 用到的自定义属性**必须有定义**（未定义=声明被丢弃）；三条本次补的变量点名；hover 底色走 `--gold-d`；窄屏 ✕ ≥40px；`.qb-menu` 的显隐 |
| §4（8） | **手机 ☰ 菜单**：非战斗/战斗两种快捷条都渲染出 `#qb-menu`；真点 ☰ → 菜单含「设置/保存进度/返回主菜单/属性/装备/姻缘义亲/我的家宅」；真点「设置」→ 真开出设置面板；真点「背包」→ 真请求 `inventory` |
| §5（5） | **桌面热键**：无弹窗按 `w` 真走 → 弹窗开着按 `w/d`/`i` 都不动 → 选择框开着也不动 → 关掉后恢复 |
| §6（3） | 长日志流：700 行 → 只留 **600**（丢开头留结尾）；新日志**自动滚到底**（喂非 0 `scrollHeight` 再断言 `scrollTop`） |

**质量自查（避免假绿）**：
- 无 `&& false` / 谓词字面量 `true` / 空 catch / 「静态 grep 当断言」。
- 一条断言在编写时是近恒真的（S5 的「数字键 1-9」）—— **已删除**，理由：本 DOM stub 里 `document.querySelectorAll('.exit-map')` 恒为 `[]`，数字键路径无从触发，留着就是「看着绿其实没测到」。该保护由同一道守卫覆盖，已在 §5 的注释里写明。
- 每条断言都喂真实调用路径的入参（真引擎 view / 真绑定的 `onclick` / 真 document 监听）。

---

## 6 · 变异自证（**5 组**，先确认缺陷复现、再判红绿）

| # | 变异 | 缺陷是否真复现 | 结果 |
|---|---|---|---|
| m1 | 把 558 行改回 `n.gender === 'female' ? '女' : '男'` | ✅ 毒蛇菜单头回到「男」 | `smoke-uiux` **44/2**：S1-2、S1-3 红 |
| m2 | 删掉 `--gold-d` 的定义（改名 `--goldX`） | ✅ `--gold-d` 变成未定义 | **42/4**：S3 四条红（两份 CSS 各 2） |
| m3 | 摘除弹窗热键守卫 | ✅ 弹窗开着按 w 真发出 `n`、按 i 真开背包 | **43/3**：S5-2/3/4 红 |
| m4 | 摘掉快捷条的 `#qb-menu` 按钮 | ✅ 渲染里不再有 ☰ | **44/2**：S4-1、S4-2 红 |
| m5 | `MAX_LOG` 600 → 10000 | ✅ 700 行全留 | **44/2**：S6-1、S6-2 红 |

**5/5 全部真变红**（每组先 `PATTERN NOT FOUND`/`NO-OP` 校验确保变异真生效、再判红；两份副本同步施加，避免罪名误落到 §0 的「副本一致」上）。还原后：`smoke-uiux` **46/0**，两份 `ui.js` `cmp` 一致、两份 `main.css` `cmp` 一致。

> **顺带发现（既有脆点，登记）**：`tools/smoke-combat.js` 的「不许把 `.def` 当数字用」护栏是**按「文件+行号」精确白名单**放行（写死 `ui.js:1120`），且**正则也扫注释**。我在文件开头插了 28 行 → 行号顶到 1148 → 该护栏**假红**。处置：**不删不放宽护栏**，把自己新增的 helper 挪到文件**末尾**（函数声明会提升，调用点不受影响），让 1120 行原样不动；另有一版注释里写了 `p.def` 字面量把护栏又扫红一次 → 已改写措辞。**该护栏本身的两处脆点（钉行号、扫注释）建议后续改成「按内容+上下文」而非行号**，本轮不动（该文件正被其他队友编辑）。

---

## 7 · 回归数字 + 两份副本 `cmp` + 改前改后 md5

**全量 smoke（36 套）**：全部 `exit=0`、✘ 计数全 0。重点保住项：
`smoke-mapui` 33/0、`smoke-quit`、`smoke-b9-intro`、`smoke-owner-bugs`、`smoke-batch4`、`smoke-uiux`（新，46/0）。
**前端 check 套件**：`game-ui-check` 80/0 · `ui-bind-check` 77/0 · `input-guard-check` 19/0 · `mapguide-check` 72/0 · `martial-ui-check` 47/0 · `kidnap-ui-check` 85/0 · `dom-page-check` 99/0。

> 回归窗口内 `smoke-combat` / `smoke-mainline` 曾各红过一次（均已复跑到全绿）：前者＝上段所述**行号白名单假红**（我改的），后者＝**其他队友正在改 `60_quests.json` / `world.js` 的进行时状态**（复跑 49/0，非本批原因）。此外 `smoke-portrait` 亦因队友数据改动闪红过一次，复跑 128/0。

| 文件 | 改前 md5（本次会话开头） | 改后 md5 | `cmp` 两份一致 |
|---|---|---|---|
| `game/src/renderer/js/ui.js` | `737e0d96061f478fb0af99de8c478196` | `9da63b28bdab84c491657a346531c71d` | ✅ 与 `server/public/js/ui.js` 逐字节 |
| `game/src/renderer/css/main.css` | `3934b06ef7d5bfa83dac453886efdb67` | `e53131eb55f5fe27950bf01e6109235f` | ✅ 与 `server/public/css/main.css` 逐字节 |
| `game/src/renderer/index.html`（版本戳） | `20261010j`（7 处） | `20261010k`（7 处） | — |

---

## 8 · 需要主人**真机**确认的步骤（触屏专属，桌面端测不出）

> 手机连**同一 WiFi**，浏览器开 `http://10.219.234.46:8800/`（**别用线上地址，线上是旧版本**）。

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 打开游戏进江湖 → 战斗里（随便打个山贼）点底部 **☰ 菜单** | 弹出菜单；点「背包」能开行囊（**改前手机上根本点不到**） |
| 2 | 关闭所有弹窗 → 点 ☰ → 点「**设置**」 | 设置面板打开（字体大小 / 动画 / 存档开关）——**改前手机上无任何入口** |
| 3 | 点 ☰ → 点「**返回主菜单**」 | 先问「退出前会先替你存好进度」，确认后回标题页且「继续游戏」按钮在 |
| 4 | 打开「**地图**」，**斜着拖**、**轻点黄框**走过去（B14 复验） | 拖得动；轻点走路；拖完不误走 |
| 5 | 点任意 NPC（如毒蛇）→ 看菜单**头部性别** | 毒蛇显示「山中猛兽 · **不明**」（**改前是「男」**） |
| 6 | 打开任意面板 → 点右上角 **✕** / 底部「关 闭」 | **点得中**（点击目标已放大），面板关掉 |
| 7 | （B5 遗留）战斗中点方向 / 拜访 / 回家按钮 | **走不动**并提示「你正与人交手…」；点「逃跑」脱战后**恢复可走**（`design/16` 的 13 步） |

---

## 9 · 未做 / 遗留 / 明确不动的

1. **B5 触屏实机验收仍未完成** —— 只能主人真机做（`design/16-touch-acceptance-checklist.md`），**不得追认**。
2. **「后端发名词、前端零逻辑」**：本轮受并发边界所限（不许碰 `core/`）未做。建议后续在 `engine.js` 的 NPC 视图里直接带上 `genderNoun`（可从 `core/pronouns.js` 取），届时删掉前端那份镜像。已登记。
3. **长日志流增量渲染**：`paintLog` 每次整块重建 600 行。本批只钉住「上限 + 滚底」；增量追加属重构，风险大，未做。
4. **宽屏日志行宽**：未设最大行宽（D2）。属排版取舍，未动，建议单独一批。
5. **明确不动**：已定稿的视觉语言（配色/字号/按钮形态/三栏布局）一律未改；`game/src/core/**` 与 `game/data/*.json` 零改动；**未执行 `git commit`**（留工作区等审批）。

---

# 批次 7c · 后续三项（护栏脆点 / ☰ 完整性 / D2 行宽）

> 触发：主理人指派（UI-POLISH 追加）。三项都在渲染层 / 前端测试边界内。

## 0 · 摘要

| 项 | 结果 |
|---|---|
| 一 · `.def` 护栏脆点 | 白名单 **「文件 + 行号」→「文件 + 整行原文 + 出现次数」**，并**新增计数断言**；行号漂移不再假红、写法被复制则必红 |
| 二 · ☰ 完整性 | 新增 `smoke-uiux` **§7**：行为化枚举 ☰ 每一项，断言**覆盖 `#sidebar` 全部入口**且**无野项**；顺带补上原先漏掉的「MOD 管理 / MOD 制作器」 |
| 三 · D2 日志行宽 | `.log-line` 加 **`max-width:72ch` 居中**；出口九宫格**豁免并居中**。只改行宽，不动配色/字号/版面 |
| 变异自证 | 新增 **5 组（m6–m10）**，含**两组「必须红」+ 一组「必须不红」** |
| 回归 | **37 套 `smoke-*.js`：我这边的套件全绿**；唯一红 `smoke-portrait-batch §1.G` 属队友进行时（见 §4）。7 套 `*-check` 全绿 |

## 1 · `.def` 护栏：行号 → 整行原文 + 次数

**原状**（`tools/smoke-combat.js`）：放行白名单是 `{ '文件': [[1120, '防御: p.def']] }` —— **钉死行号**。
**问题**：① 行号随上方任何编辑漂移 → 在文件开头加一行注释就**假红**（7b 我已踩过一次，只能把代码挪到文件末尾绕开）；② 行号方案**抓不住**「同一个写法被复制到别处」。**行号不是这条护栏要守的东西**，它守的是「这个精确写法只许出现在这一处」。

**改法**：
```js
const DEF_READ_LINE = '      攻击: p.atk, 防御: p.def, 身法: p.dodge, 格挡: p.parry, 速度: p.speed,';   // 从盘上读的真实原文
const E_DEF_ALLOW = [
  { file: 'game/src/renderer/js/ui.js',  text: DEF_READ_LINE, times: 1 },
  { file: 'server/public/js/ui.js',      text: DEF_READ_LINE, times: 1 },   // 走查不覆盖它，靠下面的计数断言兜
];
```
- 放行条件改为 **整行原文逐字相等**（`line === a.text`），保留「不整文件放行」的意图。
- **新增断言**：`白名单每条的命中次数 == 期望次数` —— 复制同一写法到别处必红；顺带能发现**两份副本在这一行上不同步**（server 副本不在走查范围内，靠此断言单独兜）。

**变异自证（两组）**：

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| **m6** | 在 `ui.js` 里把那一行**再复制一份** | 红 | ✅ `smoke-combat` **58/1**：`命中次数 == 期望次数` 红（`期望 1 次，实到 2 次`，两份副本都抓到）——**旧行号方案给不了这一层** |
| **m7** | 在 `ui.js` **顶部插一行注释**（行号整体下移） | **不红** | ✅ `smoke-combat` **59/0**（且 `smoke-uiux` 46→ 仍全绿）——**正是本修复要证明的：以前会假红** |

**顺带清理**：7b 里那段写在 helper 注释上的「行号写死 1120、别挪前面去」说明**已失实**，已改写为「位置自由（函数声明提升）」。未把 helper 挪回文件开头 —— 不为挪而挪。

## 2 · ☰ 菜单 ⊇ 侧栏面板全集（新增 `smoke-uiux` §7）

**动机**：7b 补 ☰ 是因为窄屏（≤820px）侧栏 `display:none` 后一堆面板在手机上零入口。**这是个会复发的坑** —— 以后谁加一个侧栏面板、忘了加进 ☰，手机上就又没有入口，且无人会发现。

**断言形态（行为化，不读两份清单的字面）**：
1. 从 `index.html` 的 `#sidebar` 抓**每一个** `data-panel` / `data-act`（15 + 6 = 21 个）——**声明式**，改 HTML 即被覆盖；
2. 逐个**真点** ☰ 每一项，看它**真的打开了什么**（`api.view` 收到的面板名 / 设置·存档·退出的弹窗标题 / `modcenter·modmaker` 的切屏）→ 得到「☰ 实际能到哪」的集合；
3. **S7-3 / S7-4**：侧栏每个 `data-panel` / `data-act` 都必须在这个集合里（覆盖 15/15、6/6）；
4. **S7-5**：☰ **不许有侧栏之外的野项**（两套清单各自演化正是复发的温床）。允许两项**已登记的多余项** —— `slaves`（奴册·护院）/ `guide`（江湖指引）：它们根本不在侧栏，窄屏只能靠 ☰ 进。

**顺带修掉一个真实缺口**：原 ☰ 漏了 **MOD 管理 / MOD 制作器**（侧栏有、☰ 没有）—— 按 S7-4 会红，已补上。这也说明这条断言**当场就抓到了一个真漏**。

**变异自证**：

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| **m8** | 从 ☰ 删掉「设置」 | 红 | ✅ S7-4 红（`缺：settings`）+ 连带 S4-4/6/7 红 |
| **m10** | 往 ☰ 塞一个野项（`panel:'nosuch'`） | 红 | ✅ S7-5 红（`野 panel=nosuch`） |

## 3 · D2 宽屏日志行宽

**改法**（`main.css`，只改行宽）：
```css
.log-line { …; max-width: 72ch; margin-left: auto; margin-right: auto; }
.log-line.exits { max-width: none; display: flex; justify-content: center; }   /* 出口九宫格=固定像素宽地图，豁免+居中 */
```
- **数值取 72ch**：14px 衬线字下 1ch≈0.5em≈7px → **≈504px ≈ 36 个汉字一行**（中文舒服行宽）。落在建议的 68~76ch 区间内。
- **窄屏为什么不受影响**：块级元素宽度 = `min(可用宽度, max-width)`；手机上可用宽度早小于 72ch，`max-width` 不生效 → 行为与改前一致。
- **为什么单独豁免出口九宫格**：九宫格是**固定像素宽**（可宽过 72ch）的地图，若跟着限宽会被挤坏 / 溢出居中列；改为**豁免行宽但居中放置**，观感一致且不破图。

**断言**（`smoke-uiux` §8，**CSS 契约**）：`.log-line` 确含 ch 行宽、换算后落在 **380~760px** 合理区间（防被改成 10ch 窄条或 400ch 等于没限）、左右 `auto` 居中、`.exits` 豁免并居中。
**变异 m9**（去掉行宽）→ ✅ S8-1/2/3 红。

> ⚠️ **诚实说明**：`#log` 的**行宽**属纯视觉，本环境无浏览器，**无法做像素级实测**。§8 是**样式表契约**（解析声明 + 换算校验），**观感（"读起来更舒服、且没被挤成窄条"）需人工/真机目测**。另：本次**只**给日志文字列限宽，`#room-panel`（房间描述）与 `#cmdbar` 仍整宽 —— 这是「只改行宽」的范围所致，若观感上觉得不齐，请回话，我再统一。

## 4 · 回归 + 证据

- **全量 `smoke-*.js`（37 套，含队友新加的 `smoke-sidequest`）**：本批相关套件**全 `exit=0`、✘0** —— `smoke-combat` **59/0**、`smoke-uiux` **56/0**（46→56）、`smoke-mapui` 33/0、`smoke-quit` 23/0、`smoke-b9-intro` 114/0、`smoke-owner-bugs` 235/0、`smoke-batch4` 26/0。
- **唯一红**：`smoke-portrait-batch` **§1.G**「`role/secret/obsession` 是死字段（渲染文本零出现）`got=26 want=0`」。**非本批原因**，强证：① 该断言是**数据层**（读画像字段是否出现在渲染文本）；② 它失败的原因正是**队友 `world-interact` 正在接线画像字段**（TaskList #5），字段一开始出现，这条「必须为死字段」的断言就必然红；③ 该套件 **§5「真 ui.js 渲染」段仍绿**（`5.0 真 ui.js 载入成功`）。⇒ 待 `world-interact` 完成后由其同步改这条断言。
- **7 套 `*-check` 全绿**：game-ui `80/0`、ui-bind `77/0`、input-guard `19/0`、mapguide `72/0`、martial `47/0`、kidnap `85/0`、dom-page `99/0`。
- **`cmp` 两份副本**：`ui.js` IDENTICAL、`main.css` IDENTICAL（逐字节）。
- **md5 / 版本戳**：

| 文件 | 7b 末 md5 | 7c 末 md5 |
|---|---|---|
| `game/src/renderer/js/ui.js` | `9da63b28bdab84c491657a346531c71d` | `79a2eb558363ca486221c3edab9db7c1` |
| `game/src/renderer/css/main.css` | `e53131eb55f5fe27950bf01e6109235f` | `1d008c49469d677387219e2eb3404f3e` |
| `game/src/renderer/index.html`（版本戳） | `20261010k` | `20261010m`（`l` 为改注释时的中间态，未发布；最终 `m`） |

（`server/public/` 两份副本 md5 与上表同值。）

## 5 · 遗留

- **D2 观感**：需人工/真机目测（见 §3 说明）。
- **`smoke-portrait-batch §1.G`**：待 `world-interact` 交付后由其同步改断言（非本批范围）。
- 仍**未** `git commit`；`game/data/**` 与 `game/src/core/**` 零改动。

---

# 批次 7d · 支线落地（任务号 **SIDEQUEST-LAND** · 52 条画像支线入游戏）

> 交付人：程基岩（工程 / 引擎）　日期：2026-10-10
> 上游：`design/23-sidequests-portrait-hooks.md`（52 条 hook 设计稿）· `design/portraits-new.json`（26 人 × 2 hook）
> 一句话：**设计稿里那 52 条支线，一条都不存在于游戏里**——`40_npcs.json` 的 26 个 `sidequest` 字段全是悬空指针。本章把它变成真能玩的任务。**悬空指针 26 → 0。**

## 0 · 摘要（三组数字）

| 项 | 落地前 | 落地后 |
|---|---|---|
| `40_npcs.json` 里 `sidequest` 指向 `hk_*` 的**悬空**指针 | **26**（26 人全悬空） | **0** |
| 游戏内存在的 `hk_*` 任务 | **0** | **52**（＝画像 52 个 hook，一一对应） |
| 新增 `tools/smoke-sidequest.js` 断言 | — | **48 通过 / 0 失败** |

## 1 · 落进哪里（**新文件**，旧文件零改动）

新建 **`game/data/61_sidequests.json`**（124 KB，2 空格缩进 + 尾换行，写盘后**逐字节回读比对**通过）。
`mergeData` 对 `quests/items/rooms/npcs` 按 id 深合并、`61` 在 `60` 之后加载 → 52 条任务并入，**原有 305 条任务一条未动**（`sq_npcv_*` 仍 262 条）。

数据包内容：`quests` 52 · `items` 5 · `rooms` 6 · `npcs` 27。

- **绝不碰** `60_quests.json` / `50_map.json` / `40_npcs.json`（有同事在改其文本字段）。实测 `40_npcs.json` md5 全程 `6540eae10d7fa2c0b7feacb679e26f5f` **未变**；`50_map/60_quests/70_world` 的 md5 变了，是**队友**在改，与本批无关。
- ⚠️ `mergeData` 里**数组按 replace 合并**（`arrayMode='replace'`，基础数据无法覆盖）。所以**凡“改既有房间的 `actions`”都会被整段顶掉**——本批**完全不碰既有房间的 `actions`**；只往既有房间的 `exits`（对象，按键合并）**补反向边**，安全。

## 2 · 新准入方式（为什么不用「房间 actions」）

`design/23` 的挂牌形态是「房间 `actions[cmd:接账]`」。但既有房间 `actions` 是数组、无法安全追加（见 §1 ⚠️）。改用**引擎本就支持、但此前无人用**的 **NPC `def.actions`** 通路（`commands.js:questKeyword` 已实现 `n.def.actions` 匹配）：

- **26 位挂牌 NPC** 各挂 `def.quests`（＝ 其 2 条 `hk_*`）→ `report` 能复命、`任务` 面板列「可接任务」、看人菜单出现「接…的任务」；
- **26 位各挂 `def.actions`**（52 个挂牌指令，如「接账」「问账」「盘账」）→ 玩家在房里敲该词即起任务。
- ⚠️ **挂牌指令一律不用「看」开头**：`normalizeCmd` 会把「看X」改写成 `look X`，指令就匹配不上了（本项目 B6 同源坑）。生成器内置断言 `normalizeCmd(cmd)===cmd`，生成期就拦住（已拦下过一条「上楼→u」）。

## 3 · 52 条的结构（每条）

两段式：**① 去目标房间**（`targets:[{kind:'room',var}]`，进房由 `postProcess` 自动记 var）→ **② 回 giver 交任务**，交任务时按序放：

1. 发放线索物品（`+item`，如 `deed_girl`/`iou_du`/`fake_silk`）；
2. **「秘密怎么演」**（`say`/`narrate`，2 句：一句场景 + 一句台词）——把画像的 `secret` 死字段当场演出来；
3. **抉择 `menu`**（2–3 个选项，**全部非战斗**，选项自带 `flag / ±karma / ±money / +rep / favor / ±item`）。

> ⚠️ **踩过并修掉的坑**：最初把「下一段 cond」写成「上一段的 target var」，而 `tryReportQuest` 交任务时会把该 stage 的 target var **清零** → 下一段永远接不上（stage 卡在 1）。改为**不写 cond 链**，靠 stage 顺序分段（多腿支线 `hk_npcv_223_meimei` 两条腿照样走通）。

## 4 · 新建物品 / 房间 / NPC

- **物品 5 件**（`design/23 §3`）：`ledger_yinzi` 印子账本 · `deed_girl` 一张卖身契 · `ledger_haosun` 耗损账底 · `iou_du` 一张旧字据 · `fake_silk` 一匹掺麻的绸。
- **房间 3 间**：`gusu_fengqiao` 姑苏·枫桥（连 `gusu_zhai_lane`）· `jn_granary` 东市·粮仓（连 `jn_pottery`）· `jn_yizhuang` 城西·义庄旧址（连 `jiangnan_west_road`）。**出口严格双向对称**：新房间本体写在 61，反向边以「往既有房 `exits` 补键」的方式合并（不动既有房其它键）。
- **NPC 1 位**：`hk_storyteller`「柳三弦」@ `jn_teahouse`（`design/23` 标注「待补」）。仿既有市井 NPC 建模（带 `skills/learned/title:'说书人'`），`identity-check` 48/0 仍绿。

## 5 · sidequest 指针 ⇒ quest 一一对上（**先红后绿**，本任务核心指标）

**红**（数据生成前跑 `smoke-sidequest.js`）：

```
✘ A 层 26 位 NPC 的 sidequest 悬空数 == 0  << 悬空 26：npcv_241→hk_npcv_241_yinzi, npcv_154→…, …
✘ 52 条画像 hook 全部有对应 quest  << 缺 52：hk_npcv_241_yinzi, …
✘ quests 表里 hk_* 恰好 52 条  << 0
```

**绿**（生成 `61` 后）：

```
✔ A 层 26 位 NPC 的 sidequest 悬空数 == 0   悬空 0
✔ 52 条画像 hook 全部有对应 quest   缺 0
✔ quest.name 与画像 hook.title 逐字相同（发出==读取）
✔ quests 表里 hk_* 恰好 52 条   52
✔ quests 表里没有画像之外的 hk_*
```

「**发出==读取**」逐字断言是本项目「夜戏 `jiaye_` 写 / `jiuye_` 读」教训的直接落地：`accept <任务名>` 靠 `quest.name` 模糊查找，任务名必须与画像 `hook.title` **逐字**相同（曾因把「师父那句「莫争」」写成「师父那句莫争」当场被这条断言抓红）。

## 6 · `design/23 §14` 五条「待工程实测」的**逐条结论**

| # | 悬置点 | 结论 |
|---|---|---|
| 1 | `require` 的 `favor` 型键名 | **`evalCond` 无 `favor` 键**，写 `{favor:{…}}` 会走空值分支 → **恒真**。故本批**不用 favor 前置**：第二 hook 的 `require` 统一用 `{questDone:"<前一 hook>"}`（既能表达“做过前一件”，又天然可满足、可反面验证）。 |
| 2 | `menu` 单选项能否挂 `cond` | **不能**（`menu` 选项只解析 `label>效果`）。故 Q06「凭名声」等分支**一律不做灰显**，选项恒在，效果内自判（本批无 `rep` 门槛分支）。 |
| 3 | `jn_silk_shop` 一脚踏两船（Q01/Q17 同房） | **冲突不存在**：本批没用房间 `actions`，两条支线各自把 `jn_silk_shop` 作**任务目标房**（per-quest var），互不相干。 |
| 4 | 房间 `actions` 承载量 | **绕开**：不往任何既有房间加 `actions`（见 §1/§2）。 |
| 5 | 3 新房间的严格反向边 | **已建且对称**（`smoke-sidequest §④` 扫全量基础房：非对称 0；3 房从出生点 `road_jiangnan_1` 均可达）。 |

## 7 · 引擎能力缺口（本批实测发现）

1. **`favor:<npcId>:N` 效果对模板 NPC 是空操作** —— modapi 的 `favor` 走 `w.getNpc(id)`，而 `world.getNpc = instances.npcs[id]`，**实例是按 uid 存的（`npc_mv…_7`），不是 defId** → 永远取不到。（既有 262 条 `sq_npcv_*` 的 `favor` 奖励**同样打空**。）
   **等价写法**：把好感增量**镜像进玩家变量** `favor_<npcId>`（`incvar:favor_npcv_010:30`）——可读、可作后续 cond，也正是 `design/23 §14-1` 建议的形式。**`favor:` 原样保留**（词条本身没错，日后 `getNpc` 修了自动生效）。`smoke-sidequest §③` 对 ≥12 条**同时**断言「选项真含 `favor:`」+「镜像变量真加到了」。
2. **`evalCond` 无 `fame` 键**（设计稿提到）——本批未用到，记录备查。
3. **基础数据无法注册自定义 `effectFns`** —— `world.registerFunctions` 只在 `loadMods` 路径被调用（`json.functions` 仅对 mods 生效），`61` 是基础数据、走 `loadBaseData`，故**改不了引擎行为**，只能选已支持的 effect 组合。若日后要「一步到位改真好感」，需引擎加一个 `favorTo` effect（或把 `getNpc` 支持 defId 回退）。
4. **`{day:{op,value}}` 会静默恒真**（与 `world-interact` 对账确认）：`day/level/money` 走 `NUM_FIELDS`+直接比较那条路，**不认对象里的 `op`**，`parseCmp` 拿到对象 → 退成 `{op:'>=',num:0}` → **窗口关不掉且不报错**。写窗口前置请用 `{ dayMin:N }` / `{ dayMax:M }`（本批将来补 act3-5 的窗口就用这个，纯数据侧即可，不需要动 `evalCond`），或键上带运算符的 `{ "day>=":N }`；`{time:{min,max}}` / `{season}` / `{weather}` 亦可用。

## 8 · 新测试 `tools/smoke-sidequest.js`（**57 断言 / 0 失败**）

九组：① 指针↔quest 一一对上（含「发出==读取」逐字）＋「未污染 `sq_npcv_*`」；② **52 条真 `accept`→走腿→`交任务` 全部到 stage 99**、每条都弹 `menu`；③ **14 条非战斗解法真走通**（flag/karma/money/rep/favor/item，且 `w.battle===null`）；④ 3 新房间双向对称 + 出生点可达（扫全量基础房）；⑤ **6 条「秘密怎么演」文本真出现在 `交任务` 输出里**；⑥ `require` **非恒真**（不满足接不到 / 满足接得到）；⑦ 挂牌指令真起任务；⑧ 数据面「每条 ≥2 非战斗解法」；⑨ **前置闸门端到端**（与 `world-interact` §6.13/6.14 交叉验证）：first **未开始/进行中**时 second **不**出现在「可接任务」也接不到，first **完成**后才出现且可接——打在**任务面板 + accept** 路径，与它打在**菜单渲染**路径互为独立证据。
全部走真实 `new GameEngine({seed:20261010}).boot().newGame()`；无恒真断言、无静态 grep 当断言。

## 9 · 变异自证（**4 组**：先确认缺陷真复现、再判红绿；施加后 marker 落盘校验 + 还原后 `cmp` 逐字节）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| **m1** | 把 `hk_npcv_241_yinzi` 改名（→ sidequest 指针悬空） | 红 | ✅ 悬空 `0→1`、缺 hook `1` |
| **m2** | 把 `quest.name` 与 `hook.title` 脱钩（加 `MUT`） | 红 | ✅ 「发出==读取」红：`name=绸缎庄的窟窿MUT ≠ title=绸缎庄的窟窿` |
| **m3** | 破坏 `jn_pottery.s→jn_granary` 反向边 | 红 | ✅ 非对称 `0→2`、`jn_granary` 不可达 |
| **m4** | 把 `hk_npcv_241_guancai` 的 `require.questDone` 改成未知键（→ 前置恒真） | 红 | ✅ §⑨ 红 5 条（未开始/进行中 second 都冒了出来） |

四组施加后均**先确认 marker 已在磁盘**、再判红绿；还原后 `cmp` 逐字节一致（md5 `3fef9e382afb3c25f46752ef943a9ed9` 前后同值）。

## 10 · 回归数字（**39 套 `smoke-*.js`**）

- **39 套 `exit=0`、✘0**。重点保住：`smoke-quest-data` **27/0**、`smoke-owner-bugs` **235/0**、`smoke-social` **82/0**、`smoke-mainline` **49/0**、`smoke-portrait-batch` **373/0**（原 §1.G 红已由 `world-interact` 修复）、`smoke-npc-skills` 47/0、`smoke-uiux` 61/0、`smoke-world-interact`（他批新增）全绿；`smoke-sidequest`（本批新增）**57/0**。
- **`map-check` 6492/0**（只扫 `50_map.json`，本批未碰 → 不受影响）。
- 非 smoke 校验：`identity-check` 48/0 · `input-guard-check` 19/0 · `look-detail-check` 27/0。
- ⚠️ 过程记录：中途一次全量扫描里 `smoke-quest-data §②` 复现过 `count=1` 的红，经隔离（移走 `61` 后仍红、单独复跑 3 次全绿、插桩复跑绿）判定为**队友正在并发写文件时的瞬时读**，与本批无关；干净复跑 **0 红 / 39 套**。

## 10.1 · 验收纪律（**第三条**）：跑全量前后各拍一次 md5 快照

> 由 team-lead 采纳，与既有两条并列，构成本项目**验收纪律三件套**：
> ① **验收窗口冻结 md5**；② **先确认缺陷复现、再判红绿**；③（本条）**全量回归前后 md5 快照比对**。

- **现象**：多个写手并发落盘时，把「全量一次跑完」当验收，`smoke-*` 会**偶发 `exit=1`**；单独复跑立刻全绿。本批实测遇到过一次（`smoke-quest-data §②` 报 `count=1`），`world-interact` 亦独立复现同现象；此前 `smoke-mainline`/`smoke-portrait`/`smoke-owner-bugs` 也各因并发闪红一次、复跑全绿。
- **根因**：同一进程可能在某个 `game/data/*.json` **半写状态下 `JSON.parse`**，读到旧/新混合内容 → 瞬时假红。**不是任何改动引入的回归。**
- **做法**：① 跑全量**前**对 `game/data/*.json`（+ `game/src/core/*.js`）拍一次 **md5 快照**；② 跑完再拍一次；③ **两次不一致 ⇒ 该轮结果无效**，等各 worker 落盘静默后**重跑**。
- **判据纪律**：一个「红」必须先能**排除「读到了半写文件」**，才允许往「回归」上归因。

**本批最终数字**（干净复跑，快照两次一致）：**52/52** 条支线落地、`sidequest` 悬空指针 **26→0**、`smoke-sidequest` **57/0**、全量 **39 套 `smoke-*.js` 0 红**、`map-check` 6492/0。
**附注**：本批 52 条的 stage `targets` 全为 `kind:'room'`（53 个），**无 `kind:'kill'` 目标** —— 故 team-lead 修的 B30/B31（`advanceQuestCounters` 无调用点 → 击杀型目标永不推进；`keys` 复数名单被短路忽略）**不影响本批 52 条的可完成性**（它们经 `report` 完成，本批已实测全部到 stage 99），但对主线/门派等**含击杀目标**的既有任务是真修复。

## 11 · 挑 5 条文案（请主人判味道）

1. **`hk_npcv_241_yinzi` 绸缎庄的窟窿**（和放）：
   > 他把印子账翻到折角那页，指腹压着一行小字，没念出来。
   > 「白纸黑字，你我都在上头。」
   > 抉择：**替他把账做平**（−karma 15，+money 300）／**留一份底，原样交官府**（+rep 朝廷 20，和放转冷）
2. **`hk_npcv_065_siqiliang` 元若那四十七两**（杜听涛）：
   > 元若：「我这四十七两，不催他。我就等他自己开口。」
   > 抉择：替他还／逼他开口／**替他把话说透**（+karma 10，元若 +20——他要的其实是那句实话）
3. **`hk_npcv_240_laocaifeng` 三年攒的那匹绸**（邬修远）：
   > 剪口里掺着麻丝，捋一把，扎手。
   > 「买的人一辈子摸不到里头。」
4. **`hk_npcv_237_cheng` 秤砣上那点尘**（李无咎）：
   > 义庄门口的青砖上，留着几道旧验伤的划痕。
   > 「那年我验过一个孩子。他娘抱着他来的，说只是睡着了。」
5. **`hk_npcv_164_sirenzhang` 死人账**（皮朝颜）：
   > 账本上一笔写着「采买」两个字。日期她也记得——那批孩子，是她经手的。
   > 「那笔钱，买过一批孩子的命。」

（文案纪律：具体压过形容、有账有物有动作，**不用**「神秘莫测/命运的齿轮/画卷/篇章/之旅」一类词，不排比三连。）

## 12 · 遗留 / 明确不动

- **10 条「主线窗口」支线未设主线前置**：`design/23` 给 13 条设了 `require` 主线 flag（`know_zhenyi`/`know_depot_master`）。但实测这两个 flag **当前不在任何数据文件里**（全库 grep 命中 0，只存在于 `design/21` 文档）——设上会让其中 4 条**主指针**支线（`hk_npcv_248_jiushui`/`_164_yinzi`/`_186_zuihua`/`_090_jieyao`）**永远接不到**。故：**只保留「主线之前」的 3 条**（`hk_npcv_180_beibian`/`_252_minge`/`_082_mibao` 用 `{not:{flag:...}}`，当前满足、主线一推进即关窗），**其余「主线之后」的 10 条不设前置**（保证当前可玩）。待 `act3-5` 真正落地，把窗口 `require` 加回一行即可。**0 条支线设为主线硬前置**（不卡推主线的玩家）。
- **Q13 第三条选项「动手」** 是真的 `combat:`（设计稿如此）；同条另有 2 条非战斗解法，满足「≥2 非战斗」。
- **B25 跨批集成（与 `world-interact` 对齐，已闭环）**：`world-interact` 把 `def.sidequest` 接进 `lookRoom` 内联菜单「接他的事」与 `quests` 面板「可接任务」；判据读**运行时** `w.data.quests` → 本批 `61` 并入后**自动生效**，实测 `look 和放` 菜单已长出 `接他的事[accept 绸缎庄的窟窿]`。**期间发现并修复一处小缺口**：`availableQuestOf` / 「可接任务」**未判 `require`**，导致第二 hook 在第一条进行中时冒出假入口（点了回「你还不满足接取条件」）。已给出补丁并**由 `world-interact` 在其 `commands.js` 补上**（两处判据 `if (qd.require && !evalCond(qd.require, ctx)) continue;`），它另在其 `smoke-world-interact §6.13/6.14` + 变异 `wi-require-unwire` 钉死；本批在 `smoke-sidequest §⑨` 从**任务面板 + accept** 路径加端到端断言**交叉验证**（变异 m4 自证：把该前置改成恒真 → §⑨ 红 5 条）。
- 未 `git commit`。`60_quests.json` / `50_map.json` / `40_npcs.json` / `ui.js` / `world.js` / `commands.js` **零改动**；新增仅 `game/data/61_sidequests.json`、`tools/smoke-sidequest.js`、`tools/gen-sidequests.js`（生成器，可重跑复现）、本报告。

---

# 批次 7e · 中栏统一成一列（`--col-w`）

> 触发：主理人指出「`#log` 限了 72ch，而 `#room-panel`/`#cmdbar` 仍整宽 → 大屏上『上面一行排到底、下面缩在中间』的错位，比不限宽更难看」，要求**统一到同一列**。
> （编号说明：`7d` 已被 `sidequest-land` 的支线落地占用，本节顺延为 `7e`。）

## 1 · 做法：一个变量，四块共用

| 项 | 值 / 位置 |
|---|---|
| 变量 | **`--col-w`**，定义在 `#stage`（`game/src/renderer/css/main.css`），**宽度值只此一处** |
| 值 | **`34rem`**（= 544px @100% 根字号；日志内容宽 ≈508px ≈ 36 个汉字/行） |
| 四块 | `#room-panel`（房间卡）、`.log`（日志）、`#cmdbar`（输入栏）、`.quickbar`（快捷条）→ 一律 `max-width: var(--col-w); margin-left/right: auto;` |
| 窄屏 | `@media (max-width: 820px) { #stage { --col-w: none; } }` → 四块**满宽**（手机照旧好点） |

**细节与理由**：
- **用 `rem` 不用 `px`**：设置里的「字体大小」调的是根字号，`rem` 会跟着缩放 → 一行的**字数**保持稳定。**没**动字号/配色/行高。
- **上限设在「块级卡片本身」而不是里面的文字上**：`#room-panel` 有底色+下边框，上限设在卡片上 → 底色/边框**整块**收窄居中，**不会出现「半截底色」**。
- **`#cmdbar` 是单行 flex（无 `flex-wrap`）**：提示符 + 输入框 + 发送按钮**始终同一行**，缩窄后不会被挤成两层。
- **出口九宫格继续自保**：`.exit-map{ width:fit-content; max-width:100% }` + `.em-grid{ max-width:34em }` —— 地图**本身就有上限且不会溢出容器**；`.log-line.exits` 改为占满日志宽并 `justify-content:center`。列宽收窄**不会**把地图挤坏/截断。
- **旧的第二个数字源已删**：`.log-line` 上的 `max-width:72ch` 已移除（宽度现在只由 `#log` 容器的 `var(--col-w)` 给出）。`main.css` 里**不再出现任何 `NNch`**。
- **顺带把 `.quickbar` 也纳入同一条列**（主理人点名的是前三块）：否则**快捷条会与输入栏错位**——正是本次要消掉的那个毛病。若不想要，去掉 `.quickbar` 那一行 `max-width` 即可（一行）。

## 2 · 断言（`smoke-uiux` §8，共 9 条 · CSS 契约）

| # | 守什么 |
|---|---|
| S8-1 ★ | `--col-w` 的**宽度值只定义一次**（窄屏 `none` 覆写除外）——「别三处各写一个数字」 |
| S8-2 ★ | 四块**都用** `max-width: var(--col-w)`（同值） |
| S8-3 | 房间卡：上限与它的 **background/border 在同一个元素上**（半截底色的结构防线） |
| S8-4 | 输入栏是**单行** flex（无 `flex-wrap`）→ 输入框+发送按钮不会被挤成两层 |
| S8-5 | `.exit-map` 仍 `max-width:100%`（九宫格自保，窄于列宽也不溢出） |
| S8-6 | `.log-line.exits` 仍 `justify-content:center`（地图居中放置） |
| S8-7 ★ | 窄屏断点把 `--col-w` 覆写为 `none`（手机端四块满宽可点） |
| S8-8 | 日志行内**不再**自带宽度数字（旧 `72ch` 已删；宽度只由 `--col-w` 给） |
| S8-9 | 上限折算 ≈520~780px（既非窄条也非无限宽） |

**变异自证（4 组，先确认缺陷复现再判红；两份 `main.css` 同步施加）**：

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| **m11** | `#cmdbar` 的上限改成写死的 `640px` | 红 | ✅ S8-2 红（`缺：#cmdbar`） |
| **m12** | 删掉窄屏 `--col-w: none` 覆写 | 红 | ✅ S8-7 红（未找到 820 断点覆写）＋ S8-1 红 |
| **m13** | 把上限从 `#room-panel` **卡片上拿掉** | 红 | ✅ S8-2 红（`缺：#room-panel`）＋ S8-3 红（上限不在带底色的元素上 = 半截底色） |
| **m14** | 给 `.log-line` 加回行内 `max-width:72ch` | 红 | ✅ S8-8 红（第二数字源复活） |

## 3 · 回归 + 证据

- **全量 `smoke-*.js`（39 套，队友新增 `smoke-quest-sanity`）**：本批相关套件**全 `exit=0`、✘0** —— `smoke-uiux` **61/0**（56→61）、`smoke-combat` 59/0、`smoke-mapui` 33/0、`smoke-quit` 23/0、`smoke-b9-intro` 114/0、`smoke-owner-bugs` 235/0。
- **两处红（均非本批原因）**：`smoke-portrait-batch §1.G`（`world-interact` 接线进行时，主理人已确认）;`smoke-quest-sanity`（队友新加，`grep` 确认**零处引用 renderer/ui.js/main.css**，属任务数据侧）。
- **7 套 `*-check` 全绿**：game-ui 80/0、ui-bind 77/0、input-guard 19/0、mapguide 72/0、martial 47/0、kidnap 85/0、dom-page 99/0。
- **`cmp`**：`main.css` 两份 IDENTICAL、`ui.js` 两份 IDENTICAL（逐字节）。
- **md5 / 版本戳**：

| 文件 | 7c 末 | 7e 末 |
|---|---|---|
| `game/src/renderer/css/main.css` | `1d008c49469d677387219e2eb3404f3e` | `44f6c771bfc8d3607820808d3c04f931` |
| `game/src/renderer/js/ui.js` | `79a2eb558363ca486221c3edab9db7c1` | `79a2eb558363ca486221c3edab9db7c1`（本批未改 JS） |
| `game/src/renderer/index.html`（版本戳） | `20261010m` | **`20261010n`**（7 处一致） |

## 4 · 仍需人工/真机复核 & 遗留

- **观感**（本环境无浏览器，像素级测不了）：四块是否真的对齐成一列、列宽是否舒服（非窄条）、房间卡底色是否整块包住内容、输入栏是否单行。主理人已在准备真浏览器验收。
- **M5（`#log` 增量渲染）继续不做** —— 重构风险大于收益，保持登记。
- 仍**未** `git commit`；`game/data/**` 与 `game/src/core/**` 零改动。


---

# 批次 7 · 互动与世界（WORLD-INTERACT）

> 任务：主人四句原话 ——「**npc的互动项也完善一下**」「**动态世界做好做完善了吗**」
> 「**主支线剧情与人物画像要强关联**」「有画像的背景应该会武学的人物武学做好了吗？」
> 交付人：工程负责人（程基岩）　日期：2026-10-11　未 `git commit`
> 边界：**不碰前端**（`game/renderer/**` 归 ui-polish）· **不碰 `50_map.json`/`40_npcs.json`/`60_quests.json` 文本**
> （归 text-humanize / sidequest-land；只读）· 本批战场 = `world.js`/`commands.js`/`modapi.js`/`personality.js`/`engine.js`/`70_world.json`/`tools/`

## 0 · 摘要

| 项 | 结论 |
|---|---|
| **新发现引擎地雷** | **6 条**（E1–E7，见 §1）——其中最致命 E2「`fireEvent` 不读 `worldEvents`」= B21 同族静默坑 |
| **互动项** | `lookRoom` 菜单改为**按情境给项**（有支线才给「接他的事」/能教才给「请教武学」/医者给「求医」/识路人给「问路」/倒地者给「补刀·搜身·装袋」）；新增 3 条真指令（求医/问路/搜身） |
| **动态世界 W5** | `70_world.json` 新增 `worldEvents` 顶层键，**落 12 条**（设计稿 68 条，本批落 12/68，理由见 §3） |
| **动态世界 W6** | `data.factions` 16 方 + 月度结算 + **3 处可观测外显**（look 地盘行 / 物价折扣 / `p.vars.faction_*`） |
| **动态世界 W7** | `data.calendar` **8 节 + 2 周期大事**（day%120 / periodDays 命中 → narrate + flag） |
| **画像接线** | `role`→look · `secret`/`feuds`→高信任 ask · `voice.style`→talk **句式**；并补 trust 增长通道（此前全仓无人写 trust） |
| **B22** | **7/14** 埋点已接线（真触发真出传闻）；余 7 条未落（清单见 §6） |
| **B25** | ✅ `def.sidequest` 接线（look「接他的事」+ 任务面板） |
| **有画像 NPC 武学核查** | **0 处需修**（128 位画像 NPC 逐项核过，见 §7） |
| **测试** | 新建 `tools/smoke-world-interact.js` **117 通过 / 0 失败** + 6 个变异自证 |
| **回归** | 全量 `tools/smoke-*.js`（本批时点 **39 套**）全 exit=0、零 ✘ |

---

## 1 · 新发现的引擎地雷（E1–E7）· 都是「不报错就是不生效」

| # | 地雷 | 后果 | 处置 |
|---|---|---|---|
| **E1** | `mergeData` 的 byId 分支对**原语值**也用 `Object.assign({id}, entry)`（原语被忽略，只剩 `{id}`） | `calendar.yearDays:120` → `{id:'yearDays'}` → `day % yearDays` = NaN → **节庆一条都不触发**（与 B21「数组被揉成对象」**同族**） | ✅ 修：`typeof entry !== 'object'` 直接赋值（generic，不给某键打补丁） |
| **E2** | `fireEvent(name)` **只读 `this.data.events[name]`**，不读 `worldEvents` | W5 事件库挂 `worldEvents.onDayTick` → **永远不触发**（`design/27 §2.1` 预警、`smoke-events §6` 留过结论） | ✅ 修：`data.events[name] || (data.worldEvents && data.worldEvents[name]) || []` + 非数组兜底 |
| **E3** | `addRumor()` 无 `silent` 选项（目击者 0 则 `return null`） | 世界侧传闻（天灾/械斗）**永远传不出来**（R2） | ✅ 修：`opts.silent` 免目击 |
| **E4** | `applyRumorReputation()` **不看 subject** | 世界事件（天灾）会**改玩家声望**（R4） | ✅ 修：`subject !== 'player'` 直接 return（签名加第四参） |
| **E5** | `storyline` 事件**产品侧零消费者** | onTick/onDayTick（W5/W7）/worldTick 的台词 emit 出去就沉了 —— **W5 落了也白落** | ✅ 修：`advanceTime` 期间把 storyline 收进 `_tickLines`，`engine.exec`/`menuPick` 排进玩家输出 |
| **E6** | `evalCond` 的 `var` 分支**无视 `cond.op`**（只 `parseCmp(value)`，数值默认 `>=`） | 写 `{var,op:'<',value:-40}` → **静默变成 `>=`**（设计文档与画像 hooks 全用这个写法，77 处） | ✅ 修：**纯增量**认 `op`（有运算符键时以键为准、无 op 时行为不变） |
| **E7** | 引擎无「事件冷却/一次性」字段 | 世界事件会**每天重复触发** | ✅ 修：`fireEvent` 认 `id`/`cooldownDays`/`once`（只对带 `id` 的处理器生效 → 基础事件零影响）；随档 |

> ⚠️ **E5 的连带收益**：修好后，`60_quests.json` 的 `onTick`（马蹄声）等**基础事件 say** 也终于看得见了 ——
> 这正是 B21 修完 handler 之后**残留的最后一环**（handler 执行了，但台词没人收）。

## 2 · 任务一：NPC 互动项按情境分化

`commands.js·lookRoom()` 的 `hl[].actions` 重写为**按情境给项**（给不出的项一律不给 —— 点了没反应比没有按钮更出戏）：

| 项 | 触发条件（**显式字段判据**） | 理由 |
|---|---|---|
| 看看 / 交谈 / 询问 | 恒给 | 基础 |
| **接他的事** | `availableQuestOf()`：`def.quests` **或** `def.sidequest` 里**存在、未接未做、且 `require` 前置已满足**的任务 | 有支线才给；**B25 接线**（284 人 sidequest + 13 人 quests）；悬空指针（26 人指向未落地的 `hk_*`）自动挡掉；**`require` 前置未满足也不给**（防「点下去＝你还不满足接取条件」的假入口 —— sidequest-land 实测缺口，两处并列点都加 `evalCond(qd.require)` 门） |
| 请教武学 | `def.teach` | 不能教的不给 |
| 看看货物 | `n.shop` | 无铺子的不给 |
| **求医**（新指令） | `def.tag === 'doctor'`（11 人） | 医者给；诊金按伤势算、无伤时明确回绝、钱不够明说 → **绝不静默** |
| **问路**（新指令） | `def.tag ∈ {escort,groom,boatman}` | 镖师/车夫/船夫给；**真 BFS** 算最近「有字号的地方」+ 方向 + 步数 |
| 送东西 / 查看关系 | 恒给 | 基础 |
| 攻击 | 恒给；**敌对/已交战 → 置顶**，寻常 → 置底 | 铁律 33：`hostile` **只用于排序、绝不当排除条件**（打输也是 false，不掐死装袋） |
| **补刀 / 搜身 / 装袋** | 单独一行「地上还躺着：…」，目标来自 `world.downedIn()` | 铁律 32：`npcsIn` 过滤 `dead`，倒地者不在「这里有」里；装袋只在**有麻袋**时给 |

**新增 3 条真指令**（都走既有系统、都有结果反馈）：`求医`（扣钱回血 / 明确回绝）、`问路`（BFS 真路）、`搜身`（真拿钱物 / 一人一次 / 无则明确回绝）。

## 3 · 任务二：动态世界 W5/W6/W7（**如实：做到了什么 / 没做什么**）

### W5 事件库 —— **落了 12 条，不是 68 条**

- 数据：`70_world.json` 新增 **`worldEvents` 顶层键**，`onDayTick` 下 12 条（8 类里挑了「玩家最感觉得到」的）：
  蝗灾 / 画影图形 / 大赦 / 托人递话 / 两派械斗 / 大开山门 / 说书人 / 货价波动 / 流民入城 / 迎亲 / 烽火台举烟 / 雪封山。
- **每条都有可察觉的出口**：`narrate`/`me`（房间与日志文本变了）· `flag`/`var`（面板与后续事件读得到）· `rumor:rs_e_world_*`（传闻能听到）· `+/-rep`（声望变了）。
- **为什么只 12/68**：设计稿 68 条里大量依赖「季/雨/夜/地域」的组合与**战损统计**（`_monthLoss`）等本批未建的底座；且 12 条已够跑通「**时间驱动 → 数据事件 → 玩家可见**」的核心闭环。**余 56 条是纯数据活**（照 `design/27 §5.3.2` 的表往 `worldEvents.onDayTick` 里加即可，引擎侧已就绪）。
- **`fireEvent` 读 `worldEvents` 的那一行 —— 已改**（E2），否则新键永不触发。
- 事件**冷却/一次性**（E7）已支持，否则每日重复。

### W6 势力消长 —— 月度结算 + 3 处外显

- 数据：`70_world.json` 新增 `factions` **16 方**（14 门派 + 朝廷 + 漕帮；真 id，见 `30_sects.json`）。
- 运行值：`world.factionState`（power/treasury/mood/relations），`day % 30 === 0` 结算（`worldDynamics`）；
  收入=税基（**B13 后的真房数**）× 势力；支出=弟子数×3；Δpower 钳 ±4；关系按权力差漂移并钳 −100~100。**随档**。
- **可观测（玩家能看出差别）**：
  1. `look` 多一行「**此处是<门派>的地界**（<mood>）」——状态驱动，数据不动观感变；
  2. **物价**：本派地盘上势力越盛越便宜（`buy` 叠在既有 reputation 折扣之上，各至多 15%）；
  3. `p.vars.faction_power_*` / `faction_rel_*` / `faction_rel_all`（W5 事件直接读，`design/25 §10` 契约）。
- **没做的**：弟子台词按 `mood` 换组、守卫密度随关系缩放、势力对「拜师门槛」的影响（`design/27 §3.3-1/3/5`）—— 本批**未落**，如实记。

### W7 节庆日历 —— 8 节 + 2 周期大事

- 数据：`data.calendar`：`yearDays:120`，**8 节**（元日/上元/清明/端午/七夕/中秋/重阳/岁除）+ **2 周期**（武林大会 240 天 / 漕运开帮 120 天）。
- `day % yearDays` 命中 → 执行 `effects`（narrate + flag，部分 +food/+pot）；`look` 当日多一行「今日是<节>，街上比平日热闹许多」。
- **× W5 联动**：元日当天，`w5_wanted_amnesty`（读 `flag:holiday_yuandan`）把 `wanted` 清零 —— 节庆真的改变了世界规则。
- **没做的**：5 条周期大事只落了 2 条主干；「节庆当天房间里的人变多」未做（只做了文本与 flag），如实记。

## 4 · 任务三：画像死字段接线（本任务最重要的一条）

| 字段 | 接线点 | 门槛 | 玩家在哪看到 |
|---|---|---|---|
| `role` | `look <人>` —— 一句「一眼看去，<role>。」（身份定位，**不复述 desc**） | 无（看人即见印象） | 日志 look 输出 |
| `secret` | `ask <人> about 秘密/底细/心事/隐情/把柄/瞒着/不可告人/藏着` | `trust ≥ 50 + tier×5`（tier2→60、tier3→65） | 高信任时 NPC 亲口吐露 |
| `feuds` | `ask <人> about 仇家/恩怨/结仇/仇人/冤家/过节/旧账` | `trust ≥ 40` | 高信任时说出**结怨之人真名 + 因果** |
| `voice.style` | `talk <人>` —— `personality.styleSpeak()` **改句子结构本身** | 按 `voice.style` 关键词归类到 4 种句式 | 每次交谈 |
| （新增）`trust` 增长 | **交任务 +8**（`tryReportQuest`）、**请教武学 +2** | — | 让上面的门槛**在玩法里真的够得着** |

**`voice.style` 的 4 种句式签名**（显式关键词，顺序即优先级；归不到类就**原样说话**，不硬套）：
- `terse`（话少/短句/答半句）→ **只留第一小句**
- `evasive`（留一半/绕/岔开/转开）→ **截到第一个停顿、把话咽回去（……）**
- `repeat`（一句话说两遍/三遍）→ **整句重说一遍**
- `slow`（说话慢/一顿/分三段）→ **在第一个停顿处插「顿了顿」**

> 选这个方案的理由：`voice.style` 是**自由文本**（写手写给写手看），机器不可能「懂」它的全部语义。
> 所以只按**显式关键词**归 4 类、做**句子结构**级的改写（截断/复述/插顿/削句），
> **改不出差异就原样返回**（单小句的台词本就够短，不必硬改）——**宁少勿假**。

**新增 trust 通道的必要性（查实）**：`pstate.trust` 全仓**只有读、没有写** —— 画像的
origin(0)/now(20)/want(50)/fear(70)/secret(60~65)/feuds(40) 门槛**基本永远够不着**（除 origin）。本批补上「交任务/请教」两条增长，门槛才真的有玩法意义。

## 5 · 端到端验证（5 个 NPC · 真 exec）

`tools/smoke-world-interact.js §5` 对 5 位有画像 NPC 跑**真 `exec('look …')` / 真 `exec('ask …')`**，
断言**画像里的那句话真的出现在输出里**（不是断言字段存在），并加**低信任负例**防恒真：

| NPC | role（look 输出） | secret（trust≥60 ask 输出，节选） |
|---|---|---|
| 药婆婆 | 一眼看去，华山脚下独居的老药婆，采药、看病、也替人藏东西。 | 「这话我只说一遍……她逃出唐门时带走了三张毒方……」 |
| 任停 | 一眼看去，城西破庙的挂单和尚，庙是他的，地却是道观的。 | 「……那户施主要他做假荐亡的，是因为死的人根本没死，是逃了。」 |
| 熊时 | 一眼看去，江南城放私账的女商，利滚利，欠她的账三辈子还不清。 | 「……谁赖账，她就把那人的名字说给街头的说书人听。」 |
| 毕元 | 一眼看去，当刑名师爷的官，案子到了他手里，轻重全凭他的笔。 | 「……他替一桩命案改过一行字，把该偿命的改成了流放……」 |
| 和放 | 一眼看去，东市南巷放印子钱的老财主，半条街的铺面都押在他手上。 | 「……他放出去的账，有一半是拿街坊寄在他这儿的棺材本转借的。」 |

最低信任时**五人都不吐露**（负例断言通过）。

## 6 · B22 埋点（`design/28` 14 条 → 本批落了 7 条）

| # | 种子 | 落点（模块·语义位） | 真触发验证 |
|---|---|---|---|
| 1 | `rs_theft_caught` | `commands.js` steal 的 `r.caught` 分支 | ✅ 反复偷（低成功率）→ 被抓 → 传闻表出现该 seedId |
| 2 | `rs_resist_arrest` | `world.js#witnessReaction` 官差分支（与 `p.wanted+1` 同点） | ✅ 官差目击补刀行凶 → wanted+1 + 传闻 |
| 4 | `rs_alms` | `commands.js` give_money / give（对象 ∈ 乞丐/流民/平民，显式 tag） | ✅ 给乞丐钱 → 传闻 |
| 6 | `rs_sect_join` | `commands.js` join 成功分支 | ✅ 拜华山 → 传闻 |
| 7 | `rs_sect_betray` | `commands.js` leave 成功分支 | ✅ 叛门 → 传闻 |
| 13 | `rs_bigspender` | `commands.js` buy（≥500 文）/ buyhome 成功 | ✅ 单笔 ≥500 → 传闻 |
| 14 | `rs_jailbreak` | `commands.js` escape 成功分支 | ✅ 黑市突围成功 → 传闻（房内先摆一名非 hostile 旁观者；顺带验证「无人区不传」规则**不误伤**本埋点） |

**余 7 条未落（如实）**：`rs_save_life`（无「救人成功」结算点）、`rs_tournament_win`（现仅切磋，无夺魁结算）、
`rs_deadbeat`（债务系统无「逾期赖账」明确分支）、`rs_break_marriage`（无「休妻/毁婚」指令）、
`rs_secret_out`（揭私需「把别人秘密说出去」的动作，本批只做了「听人吐露」）、`rs_dungeon_clear`（秘境通关点）、
`rs_drunkard`（无饮酒累计阈值）。**这 7 条各需要一个新结算点或新指令，属后续批**。

> ⚠️ **落地注意**：`design/28` 的 14 条里，**`about` 一律传 defId/门派 id**（决定 Δrep 落点）；
> 本批 7 条都按此传，且用 `vars:{who,where,whom}` 供种子 `texts` 插值。

## 7 · 「有画像 NPC 的武学」核查结论（**只核实，不重做**）

对 **128 位有画像 NPC**（A39/B3/C86）逐项核对（脚本口径，用**显式字段**，不扫名字/描述）：

| 检查项 | 结果 |
|---|---|
| 出家人（monk/nun/taoist）使兵刃系招式（刀/剑/棍/鞭/暗器） | **0 处** |
| 医者 / 书生 使刀法 | **0 处** |
| 画像 role 的身份词（僧/道/尼/书生）与 `tag` 不符 | **0 处**（唯一初判「道姑→nun」是**我的启发式误判**，实为 `taoist`，一致） |
| 兵刃系招式却**无兵刃/暗器物**（B8 的 49→5 残留） | **0 处**（画像人群内） |
| 画像含武身份却**无任何武学** | **0 处** |
| A 层画像 NPC 无「非 basic」招牌招式 | **2 人**（`npcv_036 鲁拂衣` / `npcv_102 闵守`，**都是书生**）——**非错配**：书生只会基本功夫合理，**不动** |

⇒ **结论：128 位画像 NPC 的武学与其身份未发现明显不符，0 处需修**。B8 的「只加不夺 / 只认显式字段 / 判不出就不动」在画像人群上依然成立 → **未改任何数据**。

## 8 · 测试 / 变异自证 / 回归

- **新建 `tools/smoke-world-interact.js`：117 通过 / 0 失败**（9 节：前置事实 / worldEvents 接线与冷却 / W5 真跨日 / W6 / W7 / 画像 5 NPC / 互动菜单 / B25+新指令 / B22（7 条逐条真触发，含 `rs_jailbreak`）/ 回归守卫）。
- **变异自证**（`tools/mutate.js`，均**先确认缺陷复现**再判红、还原后 `cmp` 逐字节一致、基线复绿）：

| 变异 | 改动 | 判红 |
|---|---|---|
| `wi-unwire-worldevents` | `fireEvent` 不再读 `worldEvents` | **7 红**（§1 全节 + §2.1/2.3 + §4.6） |
| `wi-role-unwire` | look 不再输出 role | **5 红**（5 个 NPC 的 role） |
| `wi-style-unwire` | `styleSpeak` 不再按 style 改写 | **7 红**（4 条句式 + 3 条结构） |
| `wi-ticklines-unwire` | engine 不再把 tick 台词排进输出 | **1 红**（§2.1） |
| `wi-festival-unwire` | `runCalendar` 不再命中节庆 | **4 红**（§4.1/4.2/4.6/4.7） |
| `wi-require-unwire` | 拆掉「前置未满足不算可接」的 `require` 门 | **1 红**（§6.13 冒出假入口） |

- **修好一处「既有断言守不住」**（如实报）：`smoke-portrait-batch.js` 的 §1.G 原断言
  「`role/secret/obsession` **是死字段**（渲染文本零出现）」——**它钉的正是本批要修的旧状态**，
  修好连接线后**必然判红**。已按新现实改写为：`1.G obsession 仍是死字段` + `1.H role 可见` + `1.I secret 可问出`，
  并补 1.L0b/1.L2b（role 露出、secret 高信任吐露 + **低信任负例**）。**该文件由本批与另一并行改动的合并结果**（见 §9 说明）。
- **回归**：全量 `tools/smoke-*.js` 全 **exit=0、零 ✘**（本批时点 **39 套**；含另一并行的 `smoke-sidequest`/`smoke-uiux`/`smoke-quest-data` 等）。
  重点保住：`smoke-rumor` 32/0、`smoke-events` 45/0、`smoke-kidnap` 51/0、`smoke-owner-bugs` 235/0、`smoke-mainline` 49/0、`smoke-act2`、`smoke-portrait-batch` 373/0。
- **被测文件 md5（改后）**：
  `world.js d10e9c6d…` · `commands.js e04726b1…`（注：该文件另有并行改动动了别处文本串，本批改动全部在位） · `modapi.js 90c76fd1…` · `personality.js d0e3bd0c…` · `engine.js 2a314dc5…` · `70_world.json 621b54e2…`
  （改前基线已存 `tools/_bak/`；`70_world.json` 改前备份 `tools/_bak/70_world.pre-w5.json`）

## 9 · 改动文件清单 / 遗留

**改动**：`game/src/core/world.js`（E1/E2/E3/E4/E5 半/E7 + W6/W7 引擎 + serialize）·
`game/src/core/commands.js`（互动项 / role / secret·feuds / 三新指令 / B22 六处 / W6 外显两处 / trust 增长）·
`game/src/core/modapi.js`（E6 + `rumor:` 效果）· `game/src/core/personality.js`（styleSpeak）·
`game/src/core/engine.js`（E5：tick 台词入输出）· `game/data/70_world.json`（worldEvents/factions/calendar/4 世界种子）·
`tools/gen-world-dynamics.js`（新，幂等生成器）· `tools/smoke-world-interact.js`（新）·
`tools/mutate.js`（+5 case）· `tools/smoke-portrait-batch.js`（§1 同步新现实）· `design/12` / 本文件。
**未改**：任意 `ui.js`/前端 · `50_map.json`/`40_npcs.json`/`60_quests.json`（只读）。

**遗留（如实）**：
1. W5 事件 **12/68**（余 56 条纯数据）；W6 的「弟子台词按 mood 换组 / 守卫密度 / 拜师门槛」未做；W7 的「节庆人变多」未做。
2. B22 余 **7 条**种子未接线（需新结算点/新指令）。
3. `modapi.js` 的 `op` 支持是**纯增量**（现有 76 处 `op:">="` 行为不变、1 处 `op:"<="` 从「被当 `>=`」纠正为 `<=`，落在死字段 hooks 上）。
4. 未 `git commit`（等审批）。

> **并发说明**：本批与 `sidequest-land`（落 hk 支线）、`text-humanize`、`ui-polish` 并行。
> `smoke-portrait-batch.js` 的 §1 曾被**两方同时改**（本批的 1.L0b/1.L2b 与另一方的 1.L3 重复声明 `roleSeen`）→
> 已**合并去重**（保留含低信任负例的版本），当前 373/0。此后该文件若再被并行改，请以「§1 只有一份 role/secret 断言」为准。
