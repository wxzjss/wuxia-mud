# 87 · B8 A-3 基准表：npc.level ↔ learned_max

> B8 功法重排第三批产出。口径：`ratio = learned_max / npc.level`，按身份层给锚点区间；
> 只调「严重离群」（超出锚点半档以上），边缘偏离记录不动。

## 一、分层锚点（建议定稿）

| 层 | 锚点 | 区间内 | 偏低 | 偏高 | 备注 |
|---|---|---|---|---|---|
| 掌门级 | ×6–10 | 14 | 0 | 8 | 偏高 8 人多为 ×10.0–10.6 边缘（东方不败 950/95 等），canon 依据充分，记录不动 |
| 长老级 | **×2–5**（修正） | 7 | 0 | 0 | 原建议 ×4–8 会把 A-1 刚定的 150–200 判成偏低；A-1 的三级梯度（弟子~50 → 副掌门 150–200 → 掌门 480–950）是设计意图，锚点随设计修正 |
| 经典角色 | ×6–10 | 1 | 0 | 2 | 段誉 14.2 / 林平之 13.8，canon 绝顶/辟邪加成，记录不动 |
| 守卫 | ×1–3 | 41 | 0 | 0 | 全绿 |
| 门派弟子 | ×1–3 | 158 | 0 | 0 | 全绿 |
| 城镇散人 | ×0.5–2 | 3 | 0 | **312** | 全库唯一系统性离群层，见下 |

## 二、散人层压级（已执行 ✅）

原 312 人系统性离群（ratio 6–16）→ 6 批压完（tools/_b8_press.py，备份 40_npcs_bak_pre_b8press.json）：
315 人压回锚内（普通 ×1.0 / tierB ×1.2 / tierA ×1.8 / mob 小怪 ×0.8），保 NPC 内梯度。

**例外名单（压前 grep 主线/effects combat: 引用排查所得）**：
- ×2.2 剧情档 7 人：mob_bandit / mob_bandit_chief / mob_mo_disciple / mob_assassin / mob_soldier / mob_snake / mob_wolf
  （60_quests 击杀清单 + 65/66 combat: 节点 + 61 支线 combat:mob_bandit 引用）
- 原值保留 2 人：depot_master / depot_shadow（act45 终 Boss，720/660，误压后已从备份回滚）
- 残余偏高 18 处 = 上述例外档 + 驻 40_npcs 的门派低阶弟子（beggar_info 等）+ canon 核心（nv_yue/linghu）+ lv1 floor 项（npcv_012 max6），记录不动

**批间引擎实测（护栏 2）**：tools/_b8_fight_test.js（boot→newGame→spawnNpc→startCombat→combatStep），
每批抽 2–3 代表位：mob_bandit(lv5) 3 回合分胜负、guard_city(lv18) 对 lv3 玩家秒杀（lv 差 15 级，符合梯度设计）。
⚠️ 单列发现（先于 B8 存在，非本轮引入）：lv3 入门玩家（+30 级通用功法）打 lv3 mob_wolf 仍 5 回合被咬死——
玩家成长曲线/新手战斗体验问题，wolf 数据本轮未动，建议另立「新手战力曲线」专项并入第一章施工考量。

**兵刃空装清零（护栏 3）**：smoke-npc-skills 46/1 → **47/0 全绿**。
修 4 处：mob_assassin 配 butcher_knife、npcv_156/288 武器 iron_sword_basic(剑)→steel_blade(刀)（刀=basic_blade 错配剑），
taixu_hermit（mods/demo_skill）配 fine_sword。量具 ✔ 标签里括号提示文案是预写旧诊断，判定已绿。

## 三、记录不动的边缘项

- 掌门级偏高 8 人（×10 边缘，canon 定位）
- 段誉 / 林平之 / 风清扬（canon 依据，A-2 已报备）
- 有 learned 但无 level 的 28 人（77 覆盖层 19 人等），锚不适用，维持原值
- 无 learned 的 117 人（A-2 后余量：纯剧情/纯商店功能 NPC，保留）

## 四、B8 全线收口状态

| 批 | 内容 | 结果 |
|---|---|---|
| C-1 | 散人错配功法 27 处/25 人 → 通用同类型 | ✅ 落库，守卫全绿 |
| C-2 | 弟子错配 20 处 | ✅ 转 0（first-match 口径误判，30_sects 多门共享按设计） |
| C-3 | xuedao 归属勘误 | ✅ 取消（30_sects 已挂 xuedao 门下）；黄药师/丁春秋剧情特色保留 |
| A-1 | 七门副掌门 learned_max → 150–200 | ✅ 落库 7 人，守卫全绿 |
| A-2 | 经典角色补功法 15 人 + 王语嫣保留 | ✅ 落库，守卫全绿 |
| A-3 | 本基准表 | ✅ 散人 315 人压完 + 例外 9 人，残余 18 处记录不动 |
| 收口 | 守卫 | data-load 56/56 ✅ · dangling-ref 25/25 悬空0 ✅ · smoke-npc-skills 47/0 ✅ |
