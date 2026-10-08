# 武侠行 · 高自由度武侠 MUD

一款仿「北大侠客行」风格的单机武侠 MUD，**零依赖**、自带 Mod 制作器与教程、内置 Mod 管理器，并附带一个完整的 Mod 分享网站，支持**一键上传 / 一键下载**。

> 只需一个 Node.js（18+），双击 `start.bat` 就能玩，不需要 `npm install`。

---

## 零、在线直接玩（不用装任何东西）

游戏本身就是网页游戏，已经发布到线上，**打开链接就能玩**：

| 入口 | 地址 |
| --- | --- |
| 🎮 开始游戏 | https://wuxia-mod.app.workbuddy.host/ |
| 📦 Mod 网站 | https://wuxia-mod.app.workbuddy.host/site/ |
| 📖 制作教程 | https://wuxia-mod.app.workbuddy.host/site/tutorial.html |

在线版是把「游戏服务」和「Mod 网站」合并到一个端口上跑的（`server/combined.js`）：

- 根路径 `/` → 游戏本体
- `/site/` → Mod 网站（页面内部用相对路径，天然互不干扰）
- `/api/*` → 游戏接口；`/site/api/*` → 网站接口
- `/.cloud/*` → 云服务数据面（登录、Mod 数据库）

也就是说：**想自己本地跑也一样，想直接线上玩也行**，两边代码完全同一份。

---

## 一、快速开始

### 方式一：一键下载（推荐）

打开 Mod 站首页 http://127.0.0.1:8788 ，点右上角的 **「⬇ 一键下载游戏」**。

按钮会自动把整个游戏打包成 zip 塞进你的下载文件夹，里面**已经包含全部内容**：

- 引擎 + 界面 + 100 个房间的世界数据
- 6 个可直接参考的示例 Mod
- `runtime/node.exe` **自带的 Node.js** —— 所以不用自己装
- `start.bat` 一键启动脚本
- README 完整说明

拿到 zip 后三步：

1. **解压** → 得到 `jinyong-mud` 文件夹
2. **双击 `start.bat`** → 游戏和 Mod 站一起起来，浏览器自动打开
3. **开玩**

> **不需要安装 Node.js。** 包里自带了 `runtime/node.exe`，`start.bat` 会优先用它；
> 如果你电脑上本来就有 Node，脚本也会自动改用系统的，两种都行。

想连存档一起带走？在下载页勾上「连同我的存档一起打包」即可。

> 如果 Mod 站在别的地方，也可以直接访问 `<站点地址>/api/download-game` 拿包。
> 加 `?runtime=0` 可以要一个不含 Node 的精简包（约 0.3MB），适合已经装过 Node 的人。
>
> 小提示：`node.exe` 接近 90MB，有些解压软件会漏掉大文件。
> 如果解压后没看到 `runtime` 文件夹，换 **7-Zip / Bandizip** 重新解压一次。

### 方式二：手动启动（已在本机）

双击项目根目录的 `start.bat`，会自动：

1. 启动**游戏服务** → http://127.0.0.1:8787
2. 启动**Mod 站** → http://127.0.0.1:8788
3. 自动打开浏览器

### 方式三：分开启动

```bash
runtime\node.exe server/game-server.js 8787   # 只开游戏
runtime\node.exe server/mod-site.js   8788    # 只开 Mod 站

runtime\node.exe server/mod-site.js 8788 --no-open   # 不自动打开浏览器
runtime\node.exe server/combined.js                  # 合并单端口 8800
```

装了 Node.js 的话，把 `runtime\node.exe` 换成 `node` 完全一样。
也可以直接用附带的脚本：`start-game.bat` / `start-site.bat` / `start-standalone.bat`。

### 唯一前提

装好 **Node.js 18+**（[nodejs.org](https://nodejs.org/zh-cn) 下 LTS 版）。除此之外什么都不用装——**没有 `node_modules`，不需要 `npm install`，也不联网**。

---

## 二、游戏内容规模

| 内容 | 数量 |
|---|---|
| 房间 | 100 |
| 区域 | 23 |
| 门派 | 14 |
| 武学 | 54 |
| 物品 | 59 |
| NPC | 36 |
| 任务 | 22 |
| 出身 | 6 |
| 天赋特质 | 11 |
| 书籍 | 12 |
| 商店 | 4 |

六大出身：书香门第 / 猎户之家 / 商贾之后 / 孤儿出身 / 武学世家 / 官宦子弟 —— 不同出身给不同属性、初始物品与起始武学。

---

## 三、指令系统（高自由度）

支持**中文口语**、英文缩写、界面按钮三套操作方式，随便怎么输入都认得。

### 中文口语（重点）

| 你说 | 等价于 |
|---|---|
| 往北走 / 向北走 / 去北边 / 走去南边 | `n` / `s` |
| 我要去江南城 | `go 江南城` |
| 看 / 周围 / 四周 | `look` |
| 看老槐树 | `look 老槐树` |
| 查看背包 / 看看背包 / 背包 | `i` |
| 查一下状态 / 状态 / 自己 | `score` |
| 看看武学 / 功夫 / 武功 | `skills` |
| 看一眼地图 | `map` |
| 上楼 / 下楼 / 出门 / 进屋 | `u` / `d` / `out` / `in` |
| 打坐 / 运功 / 休息 | `meditate` / `sleep` |

### 常用指令速查

```
移动   n/s/e/w/u/d/ne/nw/se/sw，go <方向|房间名>，map，where
查看   look [目标]，score，attr，skills，inventory/i，equipment/eq
       quests，affects，time，sect
交互   talk <NPC>，ask <NPC> <话题>，give <物品> <NPC>
物品   get/take <物品>，drop，use <物品>，wear/wield，remove
武学   learn <武学>，train <武学>，enable <槽位> <武学>，perform/pf <绝招>，forget
战斗   kill/fight <目标>，flee，auto
门派   sect，join <门派>，leave，promote，contribute
任务   quests，accept <任务>，report，abandon
系统   save，load，settings，mods，help，clear，rebirth
```

### 快捷键

| 键 | 作用 |
|---|---|
| `W A S D` | 上下左右移动 |
| `Q E Z C` | 斜向移动（西北/东北/西南/东南） |
| `1`–`9` | 战斗中选择招式 |
| `L` / `I` / `E` | 看 / 背包 / 装备 |
| `Esc` | 关闭弹窗 |

---

## 四、Mod 系统

### 4.1 核心设计：声明式 Mod API

**Mod 作者不需要写一行代码。** 所有 Mod 都是 JSON，用「条件（Cond）+ 效果（Effect）」描述逻辑，引擎负责求值。

一个最小可用的功能 Mod：

```json
{
  "id": "double_exp",
  "name": "双倍经验",
  "version": "1.0.0",
  "author": "你的名字",
  "category": "功能",
  "desc": "所有经验获取翻倍。",
  "rules": [
    { "name": "经验翻倍", "kind": "multiply", "target": "exp", "value": 2 }
  ]
}
```

### 4.2 支持的 Mod 类型

| 类型 | 说明 | 字段 |
|---|---|---|
| **剧情 Mod** | 多章节故事、多阶段目标、分支对话 | `quests`, `dialogues`, `stories` |
| **地图 Mod** | 新区域、新房间、新出口、条件门 | `regions`, `rooms` |
| **功能 Mod** | 改数值、加速度、自动拾取等 | `rules`, `functions` |
| **功法 Mod** | 新武学、绝招、被动 | `skills` |
| **物品 Mod** | 新装备、丹药、商店 | `items`, `shops` |
| **门派 Mod** | 新门派、职位、入门条件 | `sects` |
| **人物 Mod** | 新 NPC、对话、任务发布者 | `npcs` |

### 4.3 效果（Effect）语法

```json
{ "kind": "add",        "target": "hp",   "value": 50 }      // 加
{ "kind": "multiply",   "target": "exp",  "value": 2 }       // 乘
{ "kind": "set",        "target": "flag", "value": true }    // 设值
{ "kind": "give",       "key": "sword_01", "value": 1 }      // 给物品
{ "kind": "learn",      "key": "skill_x" }                   // 学武学
{ "kind": "teleport",   "key": "room_x" }                    // 传送
{ "kind": "message",    "text": "你感到一阵暖流。" }           // 输出文字
{ "kind": "spawn",      "key": "npc_x", "value": 1 }         // 刷新 NPC
```

### 4.4 条件（Cond）语法

```json
{ "level": { "gte": 10 } }              // 等级 ≥ 10
{ "hasItem": "key_gold" }               // 持有物品
{ "var": "quest_done", "eq": true }     // 变量判断
{ "sect": "wudang" }                    // 门派判断
{ "flag": "met_master" }                // 标记判断
{ "all": [ {...}, {...} ] }             // 全部满足
{ "any": [ {...}, {...} ] }             // 任一满足
{ "not": { ... } }                      // 取反
```

---

## 五、内置 Mod 制作器

路径：游戏内点「Mod 制作器」，或直接打开 http://127.0.0.1:8787 → Mod 制作器。

**13 个可视化标签页**，全表单填写，小白也能做：

`基本信息` · `房间` · `区域` · `NPC` · `物品` · `武学` · `门派` · `剧情` · `对话` · `功能规则` · `教程` · `JSON 源码` · `校验报告`

每个标签页都支持：
- 可视化增删改行
- 效果 / 条件行编辑器（下拉选，不用记语法）
- 一键模板预设
- 实时校验（错误 / 警告 / 建议）

做完后可以：
- **保存** → 直接装进本地 Mod 目录并启用
- **导出** → 打包成 `.zip`
- **试跑** → 临时加载看看效果，不落盘
- **一键上传** → 发到 Mod 站

---

## 六、内置 Mod 管理器

- 启用 / 禁用开关（即时生效，自动重载世界）
- 拖拽调整**加载顺序**（后者覆盖前者）
- 依赖拓扑排序 + 冲突检测
- 查看 Mod 内文件清单与内容
- 一键安装 ZIP / 从文件夹安装
- 一键导出 ZIP、打开 Mod 目录
- 问题面板：缺依赖、循环依赖、冲突、损坏 Mod 一目了然

---

## 七、Mod 网站

两个服务都用零依赖 Node 内置模块写成。

### 页面

| 页面 | 路径 | 作用 |
|---|---|---|
| 首页 | `/` | 最近上新、最受欢迎、热门标签、**一键下载游戏** |
| 列表 | `/list.html` | 搜索 / 分类筛选 / 排序 / 分页 |
| 详情 | `/mod.html?id=xxx` | 内容概览、完整 mod.json、复制、下载 ZIP |
| 教程 | `/tutorial.html` | 小白长教程，12 章节 + 语法表 + FAQ |
| 示例 | `/examples.html` | 6 类示例 Mod，可复制 / 下载 / 拿去发布 |
| 上传 | `/upload.html` | 网页版发布：粘贴 JSON / 上传 ZIP / 载入示例 |
| 下载 | `/game.html` | **一键下载完整游戏**（自动打包 zip） |

### API

```
GET    /api/health                      健康检查
GET    /api/stats                       统计
GET    /api/categories                  分类列表
GET    /api/config                      站点配置
GET    /api/game-pack                   打包信息（文件数 / 体积 / 版本）
GET    /api/download-game[?saves=1]     一键下载整个游戏（zip）
GET    /api/mods?q=&cat=&sort=&page=    列表（搜索/筛选/排序/分页）
POST   /api/mods                        发布 Mod（JSON 或 base64 ZIP）
GET    /api/mods/:id                    详情
GET    /api/mods/:id/download           取 Mod（JSON，供游戏一键安装）
GET    /api/mods/:id/file               下载 ZIP 文件
POST   /api/mods/:id/download-count     计数
POST   /api/mods/:id/delete             删除
```

### 游戏 ↔ 网站 互通

| 接口 | 说明 |
|---|---|
| `POST /api/site/upload` | 制作器一键上传（可传 spec 直接编译，或传 modId / base64） |
| `GET /api/site/remote?action=list` | 市场列表（支持 q/cat/sort/page/size） |
| `GET /api/site/remote?action=download&id=` | **一键下载并自动安装**到 Mod 管理器 |
| `GET /api/site/remote?action=ping` | 站点连通性检查 |

站点地址在游戏内「Mod 市场 → 站点设置」里配置，写入 `game/userdata/site-config.json`。

---

## 八、附带示例 Mod

`mods/` 目录下 6 个可直接参考的完整示例：

| 目录 | 类型 | 内容 |
|---|---|---|
| `demo_map` | 地图 | 听雨山庄（1 区域 + 4 房间） |
| `demo_npc` | 人物 | 白发渔翁（1 NPC + 1 物品） |
| `demo_item` | 物品 | 百宝囊（7 物品 + 1 商店） |
| `demo_skill` | 功法 | 太虚剑意（3 武学 + 2 物品 + 1 NPC） |
| `demo_quest` | 剧情 | 江南除害（1 任务 3 阶段 + 1 分支对话 + 1 NPC） |
| `demo_func` | 功能 | 轻松江湖（5 条规则） |

同一个示例也放到了 Mod 站的 `/examples.html`，可以一键复制或下载。

---

## 九、目录结构

```
jinyong-mud/
├── start.bat                 一键启动游戏 + 站点
├── start-game.bat            只启动游戏
├── start-site.bat            只启动站点
├── README.md
│
├── game/
│   ├── data/                 基础世界数据（JSON）
│   │   ├── 00_core.json      元信息 / 出身 / 区域 / 属性 / 特质
│   │   ├── 10_skills.json    武学与书籍
│   │   ├── 20_items.json     物品 / 配方 / 商店
│   │   ├── 30_sects.json     门派
│   │   ├── 40_npcs.json      NPC
│   │   ├── 50_map.json       房间地图
│   │   └── 60_quests.json    任务 / 事件 / 结局 / 成就
│   └── src/
│       ├── core/             引擎（零依赖）
│       │   ├── engine.js     总控：启动、指令、存读档、Mod 编译
│       │   ├── world.js      世界：数据加载、合并、实例、序列化
│       │   ├── character.js  角色：属性、武学、物品、状态
│       │   ├── combat.js     回合制战斗引擎（hooks 可被 Mod 覆盖）
│       │   ├── commands.js   全部指令（含中文口语归一化）
│       │   ├── modapi.js     声明式 Mod API（Cond / Effect 求值）
│       │   ├── modloader.js  Mod 扫描 / 依赖排序 / 冲突检测
│       │   ├── zipmini.js    零依赖 ZIP 读写（zlib + 自实现 crc32）
│       │   └── utils.js      工具（RNG / 深合并 / 模糊匹配 / 口语归一化）
│       └── renderer/         UI（纯 HTML/CSS/原生 JS，无构建）
│           ├── index.html
│           ├── css/main.css      水墨浅色主题
│           └── js/
│               ├── app.js        状态 / API 封装 / 工具
│               ├── ui.js         主界面 / 三栏布局 / 面板 / 战斗
│               ├── modmaker.js   可视化 Mod 制作器（13 标签页）
│               ├── docdata.js    教程 + 游戏说明 + 示例
│               └── start.js      开始屏幕 / Mod 管理器 / 市场 / 文档
│
├── server/
│   ├── game-server.js        游戏服务（8787）
│   ├── mod-site.js           Mod 站服务（8788，含一键打包下载游戏）
│   ├── public/               站点前端（7 页面 + css + js）
│   └── site-data/            站点数据（mods.json + files/）
│
├── mods/                     已安装的 Mod
├── saves/                    存档
└── tools/
    ├── e2e.js                端到端联调测试（71 项断言）
    └── smoke-test.js         引擎冒烟测试
```

---

## 十、Mod 开发示例（手写 JSON 版）

想不通过制作器、直接写文件也行。在 `mods/你的modid/mod.json` 写：

```json
{
  "id": "my_story",
  "name": "我的江湖",
  "version": "1.0.0",
  "author": "你",
  "category": "剧情",
  "desc": "一段属于你的故事。",
  "requires": [],

  "rooms": [
    {
      "id": "my_hut",
      "name": "竹篱小院",
      "region": "jiangnan",
      "desc": "院中一株老梅，檐下挂着一串风铃。",
      "exits": { "n": "jiangnan_street" }
    }
  ],

  "npcs": [
    {
      "id": "my_oldman",
      "name": "扫叶老人",
      "room": "my_hut",
      "level": 30,
      "hp": 400,
      "dialogue": "my_dlg"
    }
  ],

  "dialogues": [
    {
      "id": "my_dlg",
      "start": "n1",
      "nodes": {
        "n1": {
          "text": "老人抬起头，眼中精光一闪：「年轻人，可愿听老夫讲个故事？」",
          "choices": [
            { "text": "愿闻其详", "next": "n2" },
            { "text": "改日再来", "next": "end" }
          ]
        },
        "n2": {
          "text": "「三十年前，这院里也曾有过一场惊天动地的比剑……」",
          "effects": [
            { "kind": "give", "key": "old_sword_manual", "value": 1 },
            { "kind": "message", "text": "老人递给你一本泛黄的手抄本。" }
          ],
          "next": "end"
        },
        "end": { "text": "老人重新低下头，继续扫他的落叶。" }
      }
    }
  ],

  "quests": [
    {
      "id": "my_quest",
      "name": "扫叶老人的故事",
      "desc": "听完那段三十年前的旧事。",
      "level": 1,
      "rewards": { "exp": 200, "money": 100 },
      "stages": [
        {
          "desc": "去竹篱小院找扫叶老人。",
          "targets": [{ "kind": "room", "key": "my_hut", "count": 1, "desc": "抵达竹篱小院" }]
        },
        {
          "desc": "与老人交谈。",
          "targets": [{ "kind": "talk", "key": "my_oldman", "count": 1, "desc": "和老人说话" }]
        }
      ]
    }
  ]
}
```

放到 `mods/` 下重启游戏（或在 Mod 管理器里点刷新）即可生效。

---

## 十一、测试

```bash
# 先启动两个服务，然后：
node tools/e2e.js          # 端到端联调，71 项断言
node tools/smoke-test.js   # 引擎冒烟测试
```

`e2e.js` 覆盖：站点 API、8 个静态页面、**一键下载打包（校验 zip 魔数与文件数）**、上传 / 查询 / 下载 / 删除、游戏建角、18 条指令（含 6 条中文口语）、10 个面板、6 个存档接口、编辑器元数据与校验、跨服务一键上传 + 一键下载。

当前结果：**71 / 71 通过**。

---

## 十二、技术要点

- **零依赖**：只用 `http` / `fs` / `path` / `zlib` / `events` / `url` / `child_process`
- **ZIP 自实现**：`zipmini.js` 用 `zlib.inflateRawSync` / `deflateRawSync` + 自写 CRC32，不依赖 `adm-zip`
- **数据驱动**：世界内容全是 JSON，Mod 通过深度合并叠加（`replace` / `append` / `prepend` 三种数组策略）
- **声明式 API**：Mod 用条件与效果描述逻辑，不需要沙箱执行用户代码
- **前端零构建**：纯 HTML + CSS + 原生 JS，全局对象 `WX` / `WXUI` / `WXMM` / `WXDOC` / `WXMC` / `WXMK` / `SITE` / `EXAMPLES`
- **水墨浅色主题**：宣纸底 `#f4f1e8`、墨色 `#2b2721`、朱砂 `#9c2b25`、金 `#a8842c`

---

## 十三、常见问题

**Q：需要装 npm 包吗？**
不需要。整个项目零依赖，有 Node.js 就能跑。

**Q：Mod 会互相冲突吗？**
会检测。加载顺序决定覆盖优先级（后面的覆盖前面的），缺依赖 / 循环依赖 / 显式冲突都会在 Mod 管理器的「问题」面板里报出来。

**Q：改了 Mod 要重启游戏吗？**
不用。在 Mod 管理器里启用 / 禁用 / 调顺序都会自动重载世界。只有直接改磁盘文件才需要点「刷新」。

**Q：存档在哪？**
`saves/` 目录。存档会记录当时启用的 Mod 列表，读档时如果 Mod 对不上可以重新加载。

**Q：站点上传的 Mod 存哪？**
`server/site-data/mods.json` 存索引，ZIP 文件存 `server/site-data/files/`。

---

祝你玩得开心，也欢迎做出自己的江湖。(๑•̀ㅂ•́)و✧
