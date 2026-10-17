# 112 · label/cmd 落空最后 16 条（数据侧，游有方 2026-10-18）

> 引擎侧 label→cmd 兜底已由寇豆码落地（落空 92→16）。本批修剩余 16 条，数据侧。
> 落法：`tools/_apply_label_fix.py`（幂等，走 `_canon_write`）+ `tools/_label_fix_check.js`（真走 17/0）。

## 一、两类各怎么修

**① 12 条「动作有 label 但 effects 空」→ 补一句本地描写**（B6 兜底句消失）
- 钱府 `knock`：铜门环敲三下，声音闷在门里，脚步近两步又停住
- 衙门告示 `read`：浆糊没干透，画着一个人的脸，底下「拿获者赏」
- 登闻鼓 `knock`：牛皮鼓面闷响，守门人只抬了抬眼皮
- 藏书楼 `search 书架`：靠里那格被人动过，抽出一册账
- 江口 `drink`：江水浑，泥味压过凉味
- 青溪水塘 `fish` / 城西清溪 `fish`：浮子不动 / 溪水凉得指头发麻
- 松林 `gather`：松针软，树根下有几丛被虫啃过的蘑菇
- 山洞 `read 石壁`：三个字，末一个刻坏了
- 翰墨斋「翻架上的词本」：词本里夹着一张当票（词旧票新）
- 码头「看船期牌」：雨水泡糊两行，只剩「辰时」「午时」

**② 4 条「动作挂内置 NPC 指令」——根因是量具，不是数据**
- 徐半仙 / 元怀瑾 / 陆见山 / 王大壮 **def.room 全对**，但 NPC 实例是**进房懒生成**的（`world.npcsIncludingTemplates` 的活体闸）；
  审计脚本切房后直接 `exec('ask 徐半仙')` → 实例还没生成 → 报「这里没有」。
- 处置：动作补 effects（narrate+say，房动作自己把话说出来），**同时修量具**（`_audit_label_cmd_export.js` 切房后先 `exec('看')`）。
  修完复跑：**落空 0 / 有回应 319**（原 302 + 16）。

**③ 1 颗死键删除**：`jn_bookshop` 的 `list 林守拙` 是空动作、挡住了内置买卖（林守拙有 `shop_book`）→ 删掉，货摊恢复（真走已验证出货摊标题与货品）。

## 二、挂房纪律（这批又踩到一次）
`jn_bookshop / jn_harbor / jn_fortune / jn_yamen_court / jn_school` 的 actions 由 **62_shops 覆盖** 50_map ——
50 里「翻词本」「看船期牌」「drink 江水」都是死颗。⇒ 本批把两颗要用的动作**补进 62**，50 的重复颗留原地（无害，被覆盖）。

## 三、验收
- `node tools/_audit_label_cmd_export.js` → **落空 0 · 有回应 319**（TSV 已重生成）
- `node tools/_label_fix_check.js` → **17/0**（16 条逐条有实义输出、不出 B6/「这里没有」；`list 林守拙` 恢复货摊）
- 门禁：`data-write-guard 53/53` · 朱雀 0 条 >10 · ai-flavor 0/0 · `check-data-load 76/0` · `sidequest 57/0` · `quest-sanity 30/0` · `map 6484/0` · `portrait-batch 376/0`
- apply 两连跑幂等（第二次「改动分片 0」）

## 四、留账
50_map 里 `jn_harbor` 的 `drink 江水` 与 `jn_bookshop` 的「翻词本」等**旧颗仍在**（被 62 覆盖，永不生效）。
不删的理由：删了要动 50 的 actions 数组顺序，收益为零；若将来 62 被裁撤，它们会重新显形——届时按本档口径重新接线。

## 五、第二刀（2026-10-18 加做）：被 62 覆盖的真功能损失 + 泛称死颗

qa-lead 重出的分类版把 26 条拆成「12 条被 62 顶掉 + 14 条无 effects」；lead-programmer 复核又指出 cmd 列 9 条里 **4 条是覆盖、5 条是泛称对不上**。
本刀按这两张表逐类清：

**① 覆盖类 → 搬进 62（这些不是旧名，是独立内容）**
| 房 | 搬进 62 的动作 | 原作用 |
|---|---|---|
| jn_teahouse | 问楼里旧事 | 醉仙楼旧事（quest hk_npcv_154_maishen 指路） |
| jn_wine_house | 问那坛酒 | 那坛陈酿（hk_npcv_074_qian） |
| jn_school | 问门房 / 问旧年学籍 | 府学名额（hk_npcv_010_fuxue）/ 旧学籍（hk_npcv_036_juanzi） |
| jn_harbor | 问开船的老船家 | 旧年水路（hk_npcv_181_guanliang） |
| jn_bookshop | 翻词本 | 词本夹当票（第一刀已搬） |
| jn_harbor | 看船期牌 | 船期（改名自「看码头的船期牌」，`看` 找对象失败） |

**② 泛称类 → 从 50 删除**（62 已有真名等价动作且都补过 effects）
`ask 算命先生`（徐半仙）/ `ask 夫子`（陆见山）/ `talk 老鸨`（苗春）/ `talk 郎中`（陈济仁）/ `ask 脚夫`（王大壮）。

## 六、实证（不靠量具预热）
为排除「用 `看` 预热掩盖问题」的质疑，**把审计脚本里的预热去掉**，同一棵树复跑：

```
_audit_label_cmd_export → 候选 314 · 落空 0 · 有回应 314（label 列 0 / cmd 列 0）
```

并做了三条无预热直证：
- 引擎视角 `getRoom('jn_teahouse').actions` = `list 元若 / listen 说书 / 听人说起你 / 问楼里旧事`（62 里确实有）；
- `p.room='jn_teahouse'; p.setQuestStage('hk_npcv_154_maishen',0); exec('问楼里旧事')` **不预热也出**「三年前一船姑娘进了醉仙楼，十二个」；
- 泛称 cmd 在引擎里**已不存在**：`talk 郎中 / ask 夫子 / ask 脚夫 / ask 算命先生 / talk 老鸨` 全部 false；真名动作（`talk 陈济仁` / `ask 陆见山` / `ask 王大壮` / `ask 徐半仙` / `talk 苗春`）逐个有台词。

## 七、口径更正（记录）
上一轮我曾把「切房即 exec 报『这里没有』」归因为 NPC 懒生成，并给审计加了 `看` 预热。
**该归因只对当时那 4 条成立，不能推广**：本批 9 条的真因是「被 62 覆盖 / 泛称对不上」，与实例生成无关。
预热已从审计脚本移除（避免以后有人靠预热把真死键刷绿）。
