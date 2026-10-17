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
