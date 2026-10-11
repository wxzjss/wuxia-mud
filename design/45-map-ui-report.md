# 45 · 地图界面四项改造报告

> 主人 2026-10-10 亲报。项目：零依赖 Node.js 武侠 MUD。
> 改动文件：`game/src/renderer/js/ui.js`、`game/src/renderer/css/main.css`、`game/src/renderer/index.html`（版本戳）。
> 两份副本已同步：`server/public/js/ui.js`、`server/public/css/main.css`（`cmp` 逐字节一致）。

---

## ① 城市名被大框挡住 → 名字移到框外

**现象**（主人原话）：「地图界面城市地块被一个大框框住了，城市名字也在框中间被挡着，把城市名字往上移一下移到框外」。

**根因**：区域/城市名 `<span class="mrb-label">` 原来画在 `.map-region-box` **内部**；
而该 box 是 `z-index:0` 的层叠上下文，里面的名字被走廊(`z-index:1`)、房间方块(`z-index:2`)层层盖住，
看起来就像「名字被挡在框中间」。CSS 里它还被写成 `top:-9px`（贴着框线里侧），更强化了「压在框上」的观感。

**改前 → 改后**（`ui.js` mapHtml）：

- 改前（约 2161–2163 行）：
  ```js
  h += '<div class="map-region-box" style="...">' +
    '<span class="mrb-label" style="color:...">' + esc(box.name) + '</span></div>';
  ```
- 改后（`ui.js:2170-2198` + `ui.js:2278`）：
  - 区域外框 `.map-region-box` 只留底色/边框，**不再包含**名字；
  - 名字单独收集进 `regionLabels`，作为外框的**兄弟节点**、
    在**所有房间方块之后**输出（`h += regionLabels;`），并以独立高层级压在最上面；
  - 定位改为内联 `left` + `top = 框顶边 - round(字号×1.5)`，名字**完整位于框顶边之上（框外）**。
- CSS（`main.css:743`）：
  - 改前：`.mrb-label { position:absolute; left:6px; top:-9px; ... }`（在框内、层级低）
  - 改后：`.mrb-label { position:absolute; z-index:6; ... }`（`left/top` 由内联给，层级压在 `z-index:5` 的「你在这里」之上）

`data-region-box`（区域 id）、`data-cx/data-cy`（框中心像素坐标，供 ③ 用）也一并写进外框。

---

## ② 世界地图区域太远、手机翻着难受 → 视角自动追随玩家、地块居中

**现象**：「世界地图界面其他区域地图离得太远了，手机屏幕小翻着很难受」；
要求：「改地图界面视角保持**自动追随玩家地块到视野正中央**」。

**做法**：地图渲染完成后**每次都**把视口滚到「你在这里」那一格的正中——
开图、切「当前区域 / 天下全图」、走一步后再开图，全都自动居中。

- 中心逻辑复用既有 `centerMapOnHere()`（`ui.js:2700`，从 DOM 反读地块内联 `left/top/width`，
  不重抄几何算法），调用点固定在 `bindPanelActions` 收尾（`ui.js:2541-2547`），
  保证**每次面板重渲染都跑一次**。
- 例外：若本次是点了「区域名按钮」（见 ③）要飞往某区域，则改为居中到那个区域
  （`pendingPanRegion` 分支，`ui.js:2541-2544`），否则仍居中玩家。

**验证**：自验 ②-2 / ②-4 用固定视口 `375×400`，算「玩家格中心」与「视口中心」的偏差，
横纵均 `0.0px`（阈值半格 26px）；切一次「天下全图」重渲染后仍为 `0.0px`。

---

## ③ 新增「区域名按钮」，点一下视角飞过去

**做法**（`ui.js:2144-2151` + 绑定 `ui.js:2494-2507`）：

- 在视野切换栏与画布之间加一排 `.map-region-nav`：每个区域一个 `.mrn-btn`，
  带区域色圆点 + 区域名，当前区域高亮（`.cur`）。
- **区域清单从后端 `view.map.regions` 取，前端不硬编码名单**——
  后端加区域，按钮自动跟上（自验断言 数量 == `regions.length`、名字逐个一致）。
- 点按钮 → 若当前是「当前区域」模式（只画本区，飞不过去）：
  置 `pendingPanRegion=区域id` → 切到「天下全图」→ 重开面板 → 渲染完调用
  `centerMapOnRegion(id)` 把视口平移到该区域中心；若已在世界地图，当场平移。
- `centerMapOnRegion()`（`ui.js:2730`）从 DOM 反读该区域框的 `data-cx/data-cy`
  （mapHtml 写好的框中心像素），滚到 `center - 视口/2`，不重算布局几何。
- CSS（`main.css:800-807`）：`.map-region-nav` 横向 `overflow-x:auto` + `nowrap`，
  手机上区域多时**横滑**，不会把面板撑宽；按钮做成胶囊，手指好点。

**验证**：自验 ③-1~③-8。按钮 35 个 == 后端 35 个区域；名字一致；
点「华山」→ 世界地图里目标框 `cx=2916,cy=2760` → 视口平移到 `(2728.5,2560)`
（== 期望 `cx-375/2, cy-400/2`），且明显不同于玩家居中的位置。

---

## ④ 地图不要战争迷雾 —— 证据 & 本次补的最后一刀

主人本轮**又**提了一次，故先实测确认现状。

**现状**：第 4 轮的「战争迷雾」**绘制逻辑确已被删**（`ui.js:2252-2259` 的注释即当时留下的），
`ui.js` 里**只剩一段说明性注释**，全项目已无任何迷雾层/迷雾函数：
- 无 `fogLayer / fogMask / fogOverlay` 之类标识（自验 ④-4 源码扫描）；
- 世界地图已改为**所有地块都渲染名字**（`ui.js:2260-2269`，不再「去过才显示名字」）；
- 渲染出的 HTML 里无任何迷雾层元素（自验 ④-1）。

**但实测发现一处「漏网」——CSS 里还留着视觉迷雾**（这才是主人仍觉得有迷雾的直接原因）：

- `main.css` 改前：
  ```css
  .map-node.unknown .mn-name { color: transparent; }   /* ← 未探索地块的名字被涂成透明 */
  ```
  JS 明明给每个地块都写了名字，CSS 却把**未探索地块的名字涂成透明**，
  世界地图上看过去仍是一片「没字的小方块」= 视觉上的战争迷雾，与第 4 轮「都显示名字」的意图相矛盾。
- 改后（`main.css:775`）：
  ```css
  .map-node.unknown .mn-name { color: var(--ink-3); opacity: .72; }
  ```
  未探索地块的名字**看得清**，只是比去过的淡一点——不再有任何名字被隐藏。

**结论**：本轮删除的是「残留的 CSS 视觉迷雾」这一刀；绘制层迷雾此前已删干净（有源码/渲染证据）。

---

## 自验：`tools/_tmp-map-verify.js`

真渲染（vm 载入真 `ui.js`/`app.js`，喂真 `GameEngine.view()`，走真入口 `WXUI.panel('map')`，
读真 innerHTML，真点按钮走真绑定 onclick）：

```
① 城市/区域名移到外框外侧        6 项  ✔
② 视角自动追随玩家格居中          4 项  ✔
③ 区域名按钮：数量/名字/点击平移   8 项  ✔
④ 无战争迷雾                      4 项  ✔
—— 22 通过 / 0 失败 ——
```

---

## 回归（真跑）

| 测试 | 结果 |
| --- | --- |
| `tools/smoke-mapui.js` | 35 通过 / 0 失败 |
| `tools/smoke-round2-map.js` | 7 通过 / 0 失败 |
| `tools/mapguide-check.js` | 72 通过 / 0 失败 |
| `tools/map-check.js` | 6492 通过 / 0 失败 |
| `tools/smoke-uiux.js`（附带） | 140 通过 / 0 失败 |

镜像校验：`ui.js`、`main.css` 两份（`game/src/renderer/**` ↔ `server/public/**`）`cmp` 逐字节一致。

---

## 硬约束核对

- 两份副本已 `cp` 并 `cmp` 一致 ✔
- `.map-canvas` 的 `max-width:100%` / `max-height:54vh` 未动、仍成对；未在 CSS 中间插 `@media` ✔
- 未运行 `patch-*.js / fix-*.js / gen-*.js / mutate.js / map-snapshot.js` ✔
- 未用 `git checkout --` 还原 ✔
- 未触碰 `core/tutorial.js`、`core/commands.js` ✔
- 改前端已顺推版本戳：`index.html` 7 处 `?v=20261010t` → `?v=20261010u` ✔

## 未做项与原因

- **未改地图布局间距**（区域装箱的 `GAP`、行宽等）：主人诉求由「玩家居中 + 区域名飞过去」满足，
  改布局会牵动 `map-check.js` 的填充率/边界断言，风险大收益小，故不动。
- `tools/e2e.js` 需本地起 8787/8788 两个服务，未在本次环境中跑（与本次改动无关）。
