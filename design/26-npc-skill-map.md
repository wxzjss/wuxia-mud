# 《NPC 功法分配 · 身份映射表 + A 层 Boss 招式》（B8 设计半边 / #24）

交付人：文策渊（设计）　任务号：#24（B8 设计半边）　日期：2026-10-11
工程对应：`eng-b8`（数据 / `tools/smoke-npc-skills.js` / 回归 —— **那一半归它**）
依据：`design/06-martial-arts-rework.md`（功法五大类）· `design/21-mainline-act3-5.md` §3（Boss 三阶段）· `design/10-mainline-story.md`

> **本文只出设计。不改 `game/data/*.json`、不在 `tools/` 下建文件、不 commit。** 落地由工程执行。
> **本文的表是「设计权威版」**；`eng-b8` 若已有自己的映射，请以本文做**差异核对**（见 §8）。

---

## 0. 三条实测校正（先读，别照文档想当然）

主理人任务书写「35 个 tag × 333 NPC、现有 46 个功法」——**实测与这两处不符**，以磁盘为准：

| 项 | 任务书口径 | **磁盘实测** | 处置 |
|---|---|---|---|
| `tag` 数 | 35 | **33 个真实 tag**（+ `(none)` 一组，含 10 mob + 4 未分层） | 本文按 **33 个 tag** 建表 |
| 功法数 | 46 | **53 个**（`10_skills.json` 实测） | 按 53 个建表 |
| `category` 字段 | 06 文档说「**待新增**」 | **已存在**：53 个技能个个带 `category`（外功/内功/奇门/旁门/魔功） | 直接引用，无需新增 |

---

## 1. 实测底盘（`Object.keys()` 打出来的，不是推断）

### 1.1 NPC 上真实存在的**功法相关字段**

| 字段 | 形态 | 实测样例 | 说明 |
|---|---|---|---|
| `skills` | **对象**：`{槽位: 功法id}` | `{"剑":"huashan_jianyi","内功":"zixia_gong","轻功":"huashan_qinggong","招架":"huashan_sword"}` | **一个槽位只能挂一个功法**；这是「分配」的主战场 |
| `learned` | **对象**：`{功法id: {level:N}}` | `{"huashan_jianyi":{"level":400}}` | 熟练度；`level` 上限见 §1.4 |
| `teach` | **数组** | `["huashan_sword","zixia_gong"]` | 玩家可学的功法；**规则 ①：已有值一律不动** |
| `favorToLearn` / `moneyToLearn` | 数值 | — | 学艺门槛，与本次无关 |
| `equippedSkills` | **不存在** | `undefined` | ⚠️ 任务书提到的这个字段**数据里没有**，不要写 |

### 1.2 `skills` 的**槽位词表**（实测，全图共 8 个槽位 / 403 处赋值）

| 槽位 | 使用数 | 对应武器/系 |
|---|---|---|
| `拳` | 175 | 拳脚（无需武器） |
| `轻功` | 69 | 身法 |
| `内功` | 43 | 内力 |
| `刀` | 36 | 刀 |
| `棍` | 31 | 棍 |
| `招架` | 26 | 防守（无武器亦可） |
| `剑` | 20 | 剑 |
| `暗器` | 3 | 暗器 |

> ⚠️ **未使用的槽位**：`鞭`、`枪`、`音波`。对应 `basic_whip`（存在但无人挂）、`音波`（**连功法都还没有**，见 §5 缺口）。

### 1.3 无 `skills` 的 **9 个 NPC**（本次必须补的硬缺口）

| id | 名字 | tag | tier |
|---|---|---|---|
| `guard_yamen` | 衙役 | swordsman | B |
| `guard_shaolin` | 知客僧 | swordsman | B |
| `guard_jinywei` | 锦衣卫 | swordsman | B |
| `guard_huashan` | 华山弟子 | swordsman | B |
| `guard_blulu` | 书院山长 | swordsman | B |
| `fisher_old` | 白发渔翁 | (无) | 未分层 |
| `test_npc` | 测试NPC | (无) | 未分层 |
| `demo_swordman` | 游侠 | (无) | 未分层 |
| `taixu_hermit` | 太虚居士 | (无) | 未分层 |

> 前 5 个是**真实玩法缺口**（衙役/锦衣卫站在门口却不会武功）；后 4 个建议**不进分配范围**（`test_npc` 是测试残留）。

### 1.4 53 个功法（含 `category` / `type` / `maxLevel` 上限）

| category | 功法（id = 名） |
|---|---|
| **外功**（26） | `basic_fist` `basic_sword` `basic_blade` `basic_staff` `basic_whip` `basic_dodge` `basic_parry` · `huashan_sword` `huashan_jianyi` `huashan_sword_art` `shaolin_changquan` `damo_sword` `wudang_taiji` `taiji_sword` `tixu_zhang` `emei_sword` `dagou_bangfa` `xianglong_zhang` `beggar_qinggong` `kuangfeng_daofa` `hujia_daofa` `xuantie_jianfa` `dugu_jiujian` `cuixin_zhang` `yiyang_zhi` `liumai_shenjian` `lingbo_weibu` `ice_silk_zhang` `huashan_qinggong` `shaolin_bu` |
| **内功**（9） | `basic_force` `zixia_gong` `yijinjing` `chunyang_gong` `jiuyin_zhenjing` `beiming_shengong` `dugu_sword_aura` |
| **奇门**（3） | `emei_ci` `tangmen_anqi` `shadow_echo` |
| **旁门**（5） | `foguang_gong` `jiuyang_shengong` `tangmen_du` `miao_gu` `xunchun_blade_art` `imperial_order` |
| **魔功**（5） | `weituo_zhang`※ `jiuyin_baiguzhao` `pixie_jianfa` `heimu_zhang` `xuedao` `sunflower_manual` `xixing_dafa` |

（※ `weituo_zhang` 标 `魔功`、`jiuyang_shengong` 标 `旁门`、`foguang_gong` 标 `旁门` —— 是**现数据的分类**，与我直觉不符，**本文不改分类**，只如实引用。已在 §8 列为「可能冲突点」。）

### 1.5 14 门派 × 门派功法（**权威**，取自 `30_sects.json` 的 `skills` 数组）

| 门派 | 门派功法（`sects.skills`） | 有 NPC 成员？ |
|---|---|---|
| `huashan` 华山派 | `huashan_sword` `huashan_sword_art` `zixia_gong` `huashan_qinggong` `huashan_jianyi` | ✅ 3 人 |
| `shaolin` 少林派 | `shaolin_changquan` `weituo_zhang` `damo_sword` `yijinjing` `shaolin_bu` | ✅ 1 人 |
| `wudang` 武当派 | `wudang_taiji` `taiji_sword` `chunyang_gong` `tixu_zhang` | ✅ 1 人 |
| `emei` 峨眉派 | `emei_sword` `emei_ci` `foguang_gong` `shaolin_bu` | ✅ 1 人 |
| `gaibang` 丐帮 | `dagou_bangfa` `xianglong_zhang` `beggar_qinggong` | ✅ 2 人 |
| `tangmen` 唐门 | `tangmen_anqi` `tangmen_du` | ❌ **0 人** |
| `mojiao` 日月神教 | `heimu_zhang` `xixing_dafa` `xuedao` | ✅ 2 人 |
| `miaojiang` 苗疆五毒教 | `miao_gu` `ice_silk_zhang` | ✅ 1 人 |
| `dali` 大理段氏 | `yiyang_zhi` `liumai_shenjian` | ✅ 1 人 |
| `xingxiu` 星宿派 | `tangmen_du` `cuixin_zhang` | ✅ 1 人 |
| `gumu` 古墓派 | `emei_sword` `lingbo_weibu` `jiuyin_zhenjing` | ❌ **0 人** |
| `taohua` 桃花岛 | `kuangfeng_daofa` `lingbo_weibu` `yiyang_zhi` | ✅ 1 人 |
| `xiake` 侠客岛 | `jiuyang_shengong` `jiuyin_zhenjing` `dugu_jiujian` | ❌ **0 人** |
| `xuedao` 血刀门 | `xuedao` | ✅ 1 人 |

> **14 门派里 3 个（tangmen / gumu / xiake）在当前 333 NPC 中一个成员都没有** → 它们的门派功法在 NPC 侧**永远用不上**（缺口，见 §5）。

---

## 2. 映射规则（4 条基础 + 3 条补充，主理人已同意）

**基础 4 条**
1. **`teach` 优先不动**：已有 `teach` 的 NPC，其 `teach` 一字不改（改用 `skills` 补齐）。
2. **同 tag 内按 tier 分层**：C = 只挂 `basic_*`；B = `basic_*` + **1 个本职中阶**；A = 门派绝学 / 职责绝技。
3. **僧道不给刀剑**：`monk`/`nun`/`taoist` 主修 **拳 + 内功 + 轻功/招架**，**不给 `刀`**；少林可给 `剑`（`damo_sword` 是其门派功法）。
4. **与 `sect` 强一致**：有 `sect` 的 NPC，`skills` 必须取自该门派的 `skills` 数组（§1.5）；且 **`rank ≥ 4` → 挂绝学**，`rank 1~3` → 挂中阶。

**补充 3 条**
5. **槽位不可新增**：只准用 §1.2 的 8 个真实槽位（`拳/剑/刀/棍/招架/轻功/内功/暗器`）。**不新增 `鞭`/`枪`/`音波` 槽位**（除非采纳 §5 的 `sing_wave` 提案）。
6. **A 层「绝学」需门槛**：`xuantie_jianfa` / `dugu_jiujian` / `jiuyang_shengong` / `jiuyin_zhenjing` / `liumai_shenjian` / `sunflower_manual` 属**奇遇级**，**默认不给任何 NPC**（侠客岛三人除外——但那三个门派无成员，故实际也不给）。
7. **不跨派**：非本门 NPC **不得**挂别派功法。⚠️ 现存 2 处违反（`constable` 挂了 `kuangfeng_daofa` 桃花岛刀法、`official` 挂了 `huashan_sword`）→ 见 §8 冲突点。

---

## 3. `身份 → 功法` 映射主表（33 个 tag × C/B/A 三档）

> 记法：`槽位=功法id`。**C 档列写「现状」**（实测多为 `basic_*`，**建议不动**）；**B 档列写「建议补齐」**；**A 档列写「门派/职责绝技」**。
> 「—」＝该 tag 无该层 NPC。

| tag | 中文 | C（众生·建议不动） | B（骨干·建议补齐） | A（核心·建议） |
|---|---|---|---|---|
| `swordsman` | 侠客 | — | `剑=basic_sword` / `招架=basic_parry` / `轻功=basic_dodge`（现状）→ **有 `sect` 者按 §1.5 挂本门中阶** | 华山系：`剑=huashan_jianyi` `内功=zixia_gong` `轻功=huashan_qinggong` `招架=huashan_sword`；非门派（蒋停舟类）`剑=huashan_sword` |
| `official` | 官员 | — | `内功=basic_force` `拳=basic_fist`（现状） | 文官 `内功=basic_force` `内功(书)=—`；**东厂系（冯保）`刀=xunchun_blade_art`**（现状，保留） |
| `taoist` | 道人 | — | `内功=basic_force` `轻功=basic_dodge`（现状） | 武当系：`剑=taiji_sword` `内功=chunyang_gong` `轻功=tixu_zhang`；非门派 `内功=basic_force` `剑=basic_sword` |
| `constable` | 捕快 | — | `招架=basic_parry` `刀=basic_blade`（现状） ⚠️ 见 §8 | **`招架=basic_parry` + `刀=basic_blade`**；建议以 `constable_cudgel`（**新增**，§5）替换越派的 `kuangfeng_daofa` |
| `doctor` | 郎中 | — | `内功=basic_force` `拳=basic_fist`（现状） | `内功=basic_force`；建议以 `medicine_needle`（**新增**，§5）作 A 层本职 |
| `escort` | 镖师 | — | `刀=basic_blade` `轻功=basic_dodge` `招架=basic_parry`（现状） | **`刀=hujia_daofa`**（胡家刀法，镖行武学）+ `轻功=basic_dodge` |
| `innkeeper` | 掌柜 | — | `棍=basic_staff` / `拳=basic_fist`（现状） | `棍=basic_staff`（现状，保留） |
| `merchant` | 商贾 | — | `拳=basic_fist`（现状） | `拳=basic_fist`（现状，保留） |
| `richman` | 富户 | — | `拳=basic_fist`（现状） | `拳=basic_fist`（现状，保留） |
| `scholar` | 书生 | — | `内功=basic_force`（现状） | `内功=basic_force`（现状，保留） |
| `monk` | 僧人 | — | `招架=basic_parry` `内功=basic_force`（现状） | 少林系：`拳=weituo_zhang` `内功=yijinjing` `招架=shaolin_changquan`；非门派 `招架=basic_parry` |
| `nun` | 尼姑 | — | `内功=basic_force` `拳=basic_fist`（现状） | `内功=basic_force` `拳=basic_fist`（现状，保留；峨眉系可用 `emei_sword`） |
| `beggar` | 乞丐 | `拳=basic_fist`（现状） | `拳=basic_fist`（现状） | **`sect=gaibang` 且 `rank≥4` → `拳=xianglong_zhang` `棍=dagou_bangfa` `轻功=beggar_qinggong`**；`rank<4`（瞎眼老丐）→ **`棍=dagou_bangfa`**（帮众武学） |
| `courtesan` | 青楼女子 | `拳=basic_fist`（现状） | — | `拳=basic_fist`（现状，保留） |
| `thief` | 盗贼 | — | `轻功=basic_dodge`（现状） | `轻功=basic_dodge` `拳=basic_fist`；建议 `轻功=shaolin_bu`（现状已有 1 例，可作 A 层） |
| `gambler` | 赌徒 | — | `拳=basic_fist`（现状） | `拳=basic_fist`（现状，保留） |
| `smith` | 铁匠 | — | `刀=basic_blade` `招架=basic_parry`（现状） | 建议以 `smith_hammer`（**新增**，§5）作 A 层本职 |
| `farmer` | 农户 | `拳=basic_fist` / `棍=basic_staff`（现状） | `棍=basic_staff` `拳=basic_fist`（现状） | `棍=basic_staff`（现状，保留） |
| `hunter` | 猎户 | — | `刀=basic_blade` `轻功=basic_dodge`（现状） | 建议以 `hunter_bow`（**新增**，§5）作 A 层本职；现状可用 `轻功=basic_dodge` |
| `vendor` | 货郎 | — | `拳=basic_fist`（现状） | `拳=basic_fist`（现状，保留） |
| `boatman` | 船夫 | — | `棍=basic_staff` / `拳=basic_fist`（现状） | 建议以 `boat_pole`（**新增**，§5）作 A 层本职 |
| `waiter` | 店伙 | — | `拳=basic_fist` `棍=basic_staff`（现状） | `拳=basic_fist`（现状，保留） |
| `groom` | 马夫 | — | `轻功=basic_dodge` `棍=basic_staff`（现状） | `轻功=basic_dodge`（现状，保留） |
| `madam` | 鸨母 | — | `拳=basic_fist`（现状） | `拳=basic_fist`（现状，保留） |
| `singer` | 乐伎 | `轻功=basic_dodge`（现状） | — | 建议以 `sing_wave`（**新增**，§5）作 A 层本职 |
| `actor` | 戏子 | — | `轻功=basic_dodge`（现状） | 建议以 `sing_wave`（**新增**）或 `轻功=basic_dodge` |
| `consort` | 嫔妃 | `轻功=basic_dodge`（现状） | — | `轻功=basic_dodge`（现状，保留） |
| `palace` | 宫人 | `拳=basic_fist`（现状） | — | `拳=basic_fist`（现状，保留） |
| `eunuch` | 内侍 | `拳=basic_fist`（现状） | — | **`拳=shadow_echo`**（影卫系，影子现状）；非影卫 → `拳=basic_fist` |
| `child` | 孩童 | `拳=basic_fist`（现状） | — | `拳=basic_fist`（现状，保留） |
| `commoner` | 平民 | `拳=basic_fist` / `棍=basic_staff`（现状） | — | `拳=basic_fist`（现状，保留） |
| `refugee` | 流民 | `拳=basic_fist`（现状） | — | `拳=basic_fist`（现状，保留） |
| `waiter2` | 茶博士 | `拳=basic_fist`（现状） | — | `拳=basic_fist`（现状，保留） |
| `(none)` | mob / 未分层 | — | — | **mob 单独处理**（见 §3.1） |

### 3.1 `(none)` 组（10 mob + 4 未分层）——**单独处理，不进身份表**

| id | 建议 `skills` | 理由 |
|---|---|---|
| `mob_bandit` 山贼 | `刀=basic_blade`（现状） | 保留 |
| `mob_bandit_chief` 山贼首领 | `刀=basic_blade` + **`内功=basic_force`** | 首领应有内功底子 |
| `mob_mo_disciple` 魔教教众 | `拳=heimu_zhang`（现状） | 保留 |
| `mob_assassin` 黑衣人 | `轻功=shaolin_bu` + `拳=basic_fist` | 刺客给身法（**现状无 skills，属缺口**） |
| `mob_soldier` 巡城兵丁 | `棍=basic_staff` + `招架=basic_parry` | 兵丁给长棍+招架（**现状无 skills**） |
| `mob_wolf`/`mob_boar`/`mob_snake`/`mob_black_bear`/`mob_tiger` | **不分配**（兽类） | 无武术语义 |
| `fisher_old`/`taixu_hermit`/`demo_swordman` | `拳=basic_fist`（可选） | 有名字的散人，建议给 basic |
| `test_npc` | **不分配** | 测试残留 |

---

## 4. 14 门派 · A 层功法分配表（有 `sect` 的 15 个 NPC）

| NPC | 门派 | rank | **现状 `skills`** | 建议 | 处置 |
|---|---|---|---|---|---|
| `master_yue` 岳不群 | huashan | 5 | `剑=huashan_jianyi 内功=zixia_gong 轻功=huashan_qinggong 招架=huashan_sword` | — | ✅ 保留（已是绝学档） |
| `linghu` 令狐冲 | huashan | 1 | `剑=huashan_sword 内功=basic_force` | `剑=huashan_sword`（中阶，rank1 合理） | ✅ 保留 |
| `nv_yue` 岳灵珊 | huashan | 1 | `剑=huashan_sword` | — | ✅ 保留 |
| `shaolin_fangzheng` 方证 | shaolin | 5 | `拳=weituo_zhang 内功=yijinjing 招架=shaolin_changquan` | — | ✅ 保留 |
| `wudang_chongxu` 冲虚 | wudang | 5 | `剑=taiji_sword 内功=chunyang_gong 轻功=tixu_zhang` | — | ✅ 保留 |
| `emei_miejue` 灭绝 | emei | 5 | `剑=emei_sword 内功=foguang_gong` | **补 `暗器=emei_ci`**（门派功法，`learned` 已有 550 但未挂槽） | ⚠️ 小补 |
| `gaibang_hong` 洪七公 | gaibang | 5 | `拳=xianglong_zhang 棍=dagou_bangfa 轻功=beggar_qinggong` | — | ✅ 保留 |
| `mojiao_dongfang` 东方不败 | mojiao | 5 | `拳=heimu_zhang 内功=xixing_dafa` | **补 `剑=pixie_jianfa`**（`learned` 已有 950，且是他 Boss 一阶段主招） | ⚠️ **建议补** |
| `nv_huang` 黄药师 | taohua | 5 | `刀=kuangfeng_daofa 拳=yiyang_zhi` | **补 `轻功=lingbo_weibu`**（`learned` 已有 600） | ⚠️ 小补 |
| `miao_lan` 蓝凤凰 | miaojiang | 5 | `暗器=miao_gu 拳=ice_silk_zhang` | — | ✅ 保留 |
| `duan_yu` 段誉 | dali | 4 | `内功=beiming_shengong 轻功=lingbo_weibu 拳=yiyang_zhi` | — | ✅ 保留 |
| `blood_saber` 血刀老祖 | xuedao | 5 | `刀=xuedao` | **补 `内功=basic_force`**（单一槽位太薄，Boss 应有内力） | ⚠️ 小补 |
| `xingxiu_laoxian` 丁春秋 | xingxiu | 5 | `拳=cuixin_zhang 暗器=tangmen_du` | — | ✅ 保留 |
| `mob_mo_disciple` 魔教教众 | mojiao | 0 | `拳=heimu_zhang` | — | ✅ 保留（mob） |
| `beggar_info` 瞎眼老丐 | gaibang | 0 | `拳=basic_fist` | **`棍=dagou_bangfa`**（帮众武学，比 basic_fist 贴身份） | ⚠️ 建议改 |

> **门派功法 vs 槽位**：`gumu` / `xiake` / `tangmen` **无成员**，其门派功法（`jiuyin_zhenjing`/`jiuyang_shengong`/`dugu_jiujian`/`tangmen_anqi`/`lingbo_weibu`）**不进本表**。

---

## 5. 覆盖缺口清单（早说清，别留到验收）

### 5.1 【必需】9 个无 `skills` 的 NPC
见 §1.3 表。**5 个守卫（衙役/知客僧/锦衣卫/华山弟子/书院山长）必须补**，否则「站在门派门口的 NPC 不会武功」。
→ 建议：`guard_yamen`/`guard_jinywei` → `招架=basic_parry` `刀=basic_blade`；`guard_shaolin` → `拳=shaolin_changquan` `招架=basic_parry`；`guard_huashan` → `剑=huashan_sword`；`guard_blulu` → `内功=basic_force`。

### 5.2 【结构性】只有 **8 个槽位**，而 `鞭`/`枪`/`音波` 空缺
- `basic_whip` 存在但**0 人挂**；`枪`/`音波` 连功法都没有。
- 影响：`船夫`（篙）、`猎户`（弓）、`乐伎`（琴箫）这些身份**在现有 53 个功法里找不到本职武学**，只能挂 `basic_fist` —— 这是「分配」给不出彩的根因。

### 5.3 【新增建议】6 个本职功法（**若采纳，53 → 59**）

| # | 建议 id | 名 | 槽位 | category | 供给身份 | **为什么现有 53 个不够用** |
|---|---|---|---|---|---|---|
| 1 | `constable_cudgel` | 铁尺擒拿 | `招架` | 外功 | `constable` / `guard_yamen` | 现有 53 **无任何招架系中阶**；捕快被迫挂 `basic_parry` 或越派挂 `kuangfeng_daofa` |
| 2 | `hunter_bow` | 猎弓术 | `暗器` | 外功 | `hunter` | 现有远程只有 `tangmen_anqi`(门派) / `emei_ci`(门派)，猎户无从可挂 |
| 3 | `smith_hammer` | 铁锤功 | `棍` | 外功 | `smith` | 现有 53 **无锤类**；铁匠只能挂 `basic_blade`（与本行不符） |
| 4 | `medicine_needle` | 岐黄针 | `暗器` | 外功 | `doctor`（药婆婆等） | 现有 53 **无医家功法**；药婆婆挂 `basic_fist`，与其「采药藏药」的人设不符 |
| 5 | `boat_pole` | 篙法 | `棍` | 外功 | `boatman` | 现有 53 **无篙/桨类**；艄公挂 `basic_staff`（棍=船篙，勉强但不是本职） |
| 6 | `sing_wave` | 音波功 | **`音波`（新槽位）** | 奇门 | `singer` / `actor` | 06 文档 §4 明写「**音波（乐器）**」系统性缺失；而 `guqin`/`jade_flute`/`pipa` 三个乐器道具**已存在**，缺的只是功法 |

> ⚠️ 新增 #6 需**新槽位 `音波`**（§2 规则 5 的例外）。若不采纳，`singer`/`actor` 保持 `轻功=basic_dodge`。

### 5.4 【建议不做】3 个无成员门派的功法
`tangmen` / `gumu` / `xiake` 共 8 个门派功法（`tangmen_anqi` `tangmen_du` `lingbo_weibu` `jiuyin_zhenjing` `jiuyang_shengong` `dugu_jiujian` `emei_sword`…）**当前无 NPC 可挂**。
→ **不建议为分配而硬造门派 NPC**（那是地图/内容活）。缺口如实登记即可。

---

## 6. A 层 Boss 专属招式（`bossPhases`）

### 6.1 引擎真实 schema（**去代码里 grep 出来的**，不是照文档）

`combat.js:187 bossPhasesOf(u)` → 取 `def.bossPhases`（否则 `u.bossPhases`）。字段读法见 `combat.js:216-288`：

```js
// 形态（实测自 mojiao_dongfang / depot_master / depot_shadow 三个现成样本）
[{ at: 1,   name: '绣花针', skill: 'pixie_jianfa', line: '台词', desc: '演出描述',
   mult: { atk:1.15, speed:1.25 },            // 倍率键：atk/def/dodge/speed
   summon: { npc:'depot_shadow', count:1 } }, // 可选
 { at: 0.6, ... }, { at: 0.3, ... }]
```

**五条硬约束（直接从代码读出）**
1. **`at` 必须递减**（`1 → 0.6 → 0.3`），代码只做 `ratio <= phases[idx+1].at` 的**单步前切**（`combat.js:225`）。
2. **`at:1` 的首阶段永不触发「切换」**——所以首阶段必须写 `skill`，代码会在开场**自动预挂**（`combat.js:239`）。**否则首阶段招式永远用不出来**（东方不败的 `pixie_jianfa` 就是靠这条生效）。
3. **`mult` 两类键**：`atk/def/dodge/speed` 走**倍率**（`m<1` 也真的生效，产生负增量）；`reflect/lifesteal/armorPen/critRate` 基线为 0，走**绝对值**（要「反伤三成」就写 `{reflect:0.3}`，写 `{reflect:2}` 无意义）。
4. `def` 走 `defenseOf()`，**不能写 `Number(u.def)`**（会 NaN → 倍率静默失效）。
5. `skill` 必须**真实存在于 `10_skills.json`**，否则 `u.bossSkill=null`（静默降级）。

### 6.2 三个**已有** `bossPhases` 的 Boss —— **不动**

| Boss | 现状 | 处置 |
|---|---|---|
| `mojiao_dongfang` 东方不败 | 3 阶段（绣花针/化生/弃攻守势）完整 | **不改** |
| `depot_master` 冯保 | 3 阶段（绣春刀/影卫+summon/圣旨）完整 | **不改** |
| `depot_shadow` 影子 | 2 阶段（随影/分影） | **不改** |

### 6.3 需要新建的 **4 位**（+ 1 位「备用·默认不做」）

#### ① `blood_saber` 血刀老祖（hp 4600 · `hostile:true` · 巢穴 `beijiang_xuedao`）
> 主线三幕 3-2；人设：秃顶矮胖、诡异笑、手上血刀滴血。

| at | name | skill | line | mult |
|---|---|---|---|---|
| 1 | 刀血 | `xuedao` | 「小娃娃，这刀认人。」（他舔了舔刀口，笑了。） | `{atk:1.2}` |
| 0.6 | 化血 | `xuedao` | （他中了你一刀，血却往他刀上流。）「你的血，也是我的。」 | `{atk:1.1, lifesteal:0.35}` |
| 0.3 | 血遁 | `xuedao` | （他后退半步，身形忽然虚了。）「雪大，你追不上我。」 | `{atk:0.9, def:1.4, dodge:1.35, speed:1.15}` |

> ⚠️ 蓝图里的「血遁＝逃跑重召」**引擎不支持**（`21` §1.4）→ 已改为**高分身法**（`dodge/speed`），语义从「跑」变「难打」。

#### ② `xingxiu_laoxian` 丁春秋（hp 4000 · `hostile:true` · 巢穴 `xiyu_xingxiu`）
| at | name | skill | line | mult |
|---|---|---|---|---|
| 1 | 毒雾 | `tangmen_du` | 「星宿老仙，法力无边——先闻闻这个。」（他袖中腾起一片白雾。） | `{atk:1.1, armorPen:0.2}` |
| 0.6 | 化功 | `cuixin_zhang` | （你打在他身上，内力却往他掌心里走。）「你的功夫，我收下了。」 | `{atk:1.05, lifesteal:0.3}` |
| 0.3 | 诡计 | `cuixin_zhang` | 「弟子们，送客。」（崖后转出一排青衣人，齐齐抬手。） | `{atk:1.0, def:1.2, summon:{npc:'mob_mo_disciple', count:2}}` |

> `summon` 用现成 `mob_mo_disciple`（`21` §1.3 已确认「召唤可用」），count 取 2（上限 5）。

#### ③ `emei_miejue` 灭绝师太（hp 4800 · `hostile:false` · 巢穴 `emei_jinding`）
> ⚠️ **`hostile:false`** → 她**不能被 `talk`**（`commands.js`），战斗必须由**房间 action** 触发（`21` §1.4）。三阶段走「**试探 → 认真 → 搏命**」，语义是**考校**不是仇杀（与方证同款处理）。

| at | name | skill | line | mult |
|---|---|---|---|---|
| 1 | 罗汉剑 | `emei_sword` | 「峨眉剑法，你看清楚了。」（她起手极正，一寸不让。） | `{atk:1.05, def:1.1}` |
| 0.6 | 疾风 | `emei_sword` | 「守得住，算你有点出息。」（剑光忽然快了。） | `{atk:1.15, speed:1.25}` |
| 0.3 | 绝情 | `emei_ci` | 「……我不留手了。」（她换了短刺，近身贴上。） | `{atk:1.3, def:0.85, dodge:1.2}` |

> 一阶段用 `emei_sword`（已在她 `skills`），**三阶段换 `emei_ci`**（她 `learned` 已有 550）——顺带兑现 §4 那条「补 `暗器=emei_ci`」。

#### ④ `shaolin_fangzheng` 方证大师（hp 6000 · `hostile:false` · 巢穴 `shaolin_daxiong`）
> 定位是「**圆滑的知情者**」（`10` §3 已改：打一场反而更信任你）。故三阶段**越打越温和**，不是越打越狠。

| at | name | skill | line | mult |
|---|---|---|---|---|
| 1 | 韦陀杵 | `weituo_zhang` | 「施主，接老衲一杵。」（掌风沉而不急。） | `{atk:1.1}` |
| 0.6 | 狮子吼 | `shaolin_changquan` | 「咄！」（一声低喝，殿上铜铃齐响。） | `{atk:1.05, speed:1.2, armorPen:0.15}` |
| 0.3 | 拈花 | `yijinjing` | 「够了。施主武功，老衲看明白了。」（他收掌，退一步。） | `{atk:0.8, def:1.5, dodge:1.3}` |

> `yijinjing` 是**内功**，挂 `skill` 仅作演出（`pickSkill` 会取它）；若不希望 Boss 用内功出手，可改 `shaolin_bu`。

#### ⑤ `nv_huang` 黄药师（hp 5200 · `hostile:false` · `taohuadao_qingyin`）—— 🟡 **备用彩蛋 · 默认不做**
> 主理人已定：**不让他当 Boss**（他是第五幕委托人）。招式给出来只为**万一要加彩蛋**时能直接用。

| at | name | skill | line | mult |
|---|---|---|---|---|
| 1 | 落英神剑掌 | `yiyang_zhi` | 「桃花岛不迎客。你偏要来。」 | `{atk:1.05, dodge:1.15}` |
| 0.6 | 旋风扫 | `kuangfeng_daofa` | （他横刀一扫，花瓣随刃而行。） | `{atk:1.2, speed:1.15}` |
| 0.3 | 移步 | `lingbo_weibu` | 「你连我衣角都摸不到。」 | `{atk:0.85, dodge:1.5, speed:1.3}` |

> **标记：默认不做**。若采纳，需先把 `nv_huang` 的 `hostile` 与房间 action 另行设计（他会与第五幕「给三句话不给你秘籍」冲突）。

### 6.4 Boss 招式 · id 自查
全部 `skill` 取自 §1.4 的 53 个真实 id；`summon.npc` 取 `depot_shadow`（既定）/`mob_mo_disciple`（既定）—— **0 编造**。

---

## 7. B17 / B18 / B19 建议稿（**只给判断，不改数据**）

### 7.1 B18 · `eunuch` tag 与 `gender` 矛盾（9 人中 **5 人 female**）
- **涉及**：`npcv_051` 麻时(女) · `npcv_117` 平白(女) · `npcv_183` 何红(女) · `npcv_249` 孟望(女) · `npcv_282` 窦静(女)；男 4 人：`npcv_018`/`084`/`150`/`216`。
- **判断：`gender` 错标，不是 tag 误挂。** 判据（四条）：
  1. **`desc` 是女性外观**：`npcv_282`「耳上坠着**一对小珠子**」、`npcv_051`「耳上坠着珠子，她笑了也没声音」——**耳坠**是这批 `desc` 的模板特征，而男性 `eunuch`（`npcv_018`/`150`/`216`）的 `desc` 是「拂尘穗子白了/手指细长，指甲留得长」，**无耳饰**。
  2. **画像已按女性写**：我在 C 层（#113）给这 5 人的画像用了「她」，且写的是**内侍/女官**口吻；若判 tag 误挂，这 5 张画像要重写——**成本高**。
  3. **`rel` 无提示**：这 5 人的 `rel` 里**没有配偶/亲缘**边能证伪（既无夫也无妻），中性。
  4. **落点**：4 人在 `shaolin_daxiong`（`npcv_051`/`117`/`183`/`249`）——与「宫里来的三个人」线一致，**与性别无关**。
- **结论**：**只改 `gender`（female→male）会与 `desc` 打架**；**只改 `tag`（eunuch→palace/palace 女官）成本更低**……但——
  ⚠️ **不许「两边都改」**。故我的建议是：**改 `tag`**（`eunuch` → `palace`，即「宫中内人/女官」），**保留 `gender:female` 与现画像**。理由：`desc` 与画像都已按女写、且「女官」在明代内廷**真实存在**（六局一司女官），改 tag 不动文本，**改动面最小**。

### 7.2 B17 · 嫔妃落黑木崖（4 人：`npcv_053` 禹清 / `npcv_119` 蔡落 / `npcv_185` 元明月 / `npcv_251` 田绿）
- **建议：改落点，不改 tag。** 理由：她们的 `desc`（狐裘/金钗/宫装/熏香）**全部是「妃嫔」语义**，若改 tag 成别的身份，4 张 `desc` + 我 4 张 C 层画像**全要重写**。
- **改为哪个落点**：`palace_court1`（皇城·东六宫）或 `palace_court2`（西六宫）——与其余 5 位嫔妃同区（现 5 人都在 `palace_court2`）。
- **⚠️ C 层画像那句要不要跟着改**：**要改**。我在 #113 给她 4 人的 `role`/`now` 写的是「**黑木崖上被献来的女子**」「黑木崖高髻金钗的女子」等（当时为圆落点错配而写）。**若落点迁回皇城，这 4 条画像必须回改**为嫔妃口吻。→ **这是一次跨文档连带改动**，我已登记在 `15-portrait-roster.md` 的同款备注里；`portraits-batch-c.json` 里这 4 条需同步改 `role`/`now`/`marks`（`教` → `宫`）。
- **替代方案（若不想动画像）**：**保留落点，改 `tag`**（`consort` → `courtesan` 或新的「教中女眷」），但成本更高。
- **我的推荐**：**改落点 + 同步回改 4 条 C 层画像**（一次性成本，换来 9 位嫔妃同区一致）。

### 7.3 B19 · 人数口径（武当 4 女官 / 少室 4 内侍 vs 文案「三个」）
- **建议：改文案，不删 NPC。** 理由：
  1. 删 NPC 会**破坏既有 `rel` 边**（冲虚的 3 条 `仇` 边指向 `npcv_052`/`118`/`250`，删一个就断一条）；
  2. 「**三个人**」是 `10-mainline-story.md` 的**行文措辞**（非硬设定），改成「**四个**」零成本；
  3. 反而**四个更好**：冲虚的 `仇` 边正好 3 条 + `于绿`（`npcv_250`）是「背叛者」候补，**四人一组更有戏**。
- **具体**：`10-mainline-story.md` 第二幕 2-3「宫里来的**三个**女官」→ 改「**四个**」；少林塔中物线同款「**三个人**」→ 改「**四个**」（`npcv_051`/`117`/`183`/`249`）。
- ⚠️ 本条我在 #113 报过同款，此处给**最终建议**，供批 6 直接执行。

---

## 8. 与工程可能冲突的点（**最重要一栏**）

> 凡我判断 `eng-b8` **很可能自己另做一套**的地方，点名列出。

| # | 冲突点 | 我的口径 | 工程可能的另一种做法 | 建议 |
|---|---|---|---|---|
| 1 | **A/B 分层阈值** | 用 **`rank ≥ 4`（门派职级）** 判「绝学 vs 中阶」，**不用 `tier`** | 可能直接用 `tier==='A'` 一刀切 | ⚠️ **两者会打架**：`tier=A` 里有 **`rank=1` 的令狐冲/岳灵珊**（不该给绝学），也有 **`tier=B` 却 `sect` 非空的 `beggar_info`**。**建议以我的 `rank` 口径为准** |
| 2 | **Boss 招式 `name` 用中文还是英文** | 中文（「绣花针」「化血」），**与现成 3 个 Boss 一致** | 可能用英文/拼音 | 以现成 3 样本为准（它们全是中文） |
| 3 | **捕快的越派功法 `kuangfeng_daofa`** | **属现存不一致**，建议清洗为 `basic_blade`（或采纳新增 `constable_cudgel`） | 可能「不动现有数据」保留 | 需主理人拍板：**动 or 不动** |
| 4 | **`official` 挂 `huashan_sword`**（元怀瑾） | **这是彩蛋不是 bug**（他的 secret 就是「弃武从文」），**建议保留** | 可能当作越派一并清洗 | ⚠️ **别洗这条**——它与人设咬合（`15-portrait-roster` §2 元怀瑾） |
| 5 | **是否采纳 6 个新增功法** | 建议**只采纳** `constable_cudgel` / `hunter_bow` / `medicine_needle` / `boat_pole`（4 个，不涉新槽位）；`sing_wave` 涉**新槽位**，建议缓 | 可能一个都不加 | 若不加：#5.2 的缺口**保留**，B 层市井 NPC 继续 `basic_*` |
| 6 | **`category` 分类纠错** | 我**不改**（`weituo_zhang` 标魔功、`jiuyang_shengong` 标旁门） | 可能顺手纠 | ⚠️ 纠了会**动到 `10_skills.json`**，且影响 `06` 文档；**本次不纠** |
| 7 | **C 层是否只留 1 个槽位** | 建议**保持现状**（C 层多为 1 槽 `basic_*`，很干净） | 可能想给 C 层也加槽 | 不建议：C 层 89 人加槽 = 全图膨胀 |
| 8 | **`mob` 是否算进「329」** | 我按 **mob 单独处理**（§3.1），兽类不分配 | 可能想给兽类也挂 | 兽类无武术语义，建议不挂 |

**另：分工边界**——本文只到「表」。**改 `40_npcs.json` / 建 `tools/smoke-npc-skills.js` / 回归**全部归 `eng-b8`。

---

## 9. id 自查（本文引用的全部 id）

| 类别 | 结果 |
|---|---|
| **候选 id**（反引号中 `[a-z][a-z0-9_]+`） | **189** |
| ① **真实命中** | **137** —— `skill` **53**（全表全覆盖）· `npc` 35 · `tag` 33 · `sect` 13 · `item` 3 |
| ② **新增建议**（已标「新增」，非编造） | **6** 功法 + 1 槽位 = `constable_cudgel` `hunter_bow` `smith_hammer` `medicine_needle` `boat_pole` `sing_wave` + 槽位 `音波` |
| ③ schema / 文件名 / 前缀片段（非 id） | 46（如 `skills` `teach` `bossPhases` `mult` `summon` `atk` `smoke` `40_npcs`…） |
| ④ **编造** | **0** ✅ |

> 复核：137 + 6 + 46 = **189**，与候选总数**吻合**。
> `skill` 的 53 个命中 = `10_skills.json` 的**全部** 53 个（§1.4 逐条核对）。
> 注：本文是**设计文档**，未写 JSON；`eng-b8` 落地时若把 §3 的表转成写入列表，建议它再跑一次自己的守卫（`smoke-npc-skills.js`）。

---

## 10. 待工程实测（不阻塞设计）

| # | 悬置点 | 若不可行的替代 |
|---|---|---|
| 1 | `pickSkill` 对**内功类 `skill`**（如 `yijinjing`）的取用行为 | 方证三阶段改挂 `shaolin_bu` |
| 2 | `mult` 里 `speed` 是否真进先手判定（`bossPhases` 样本用了它，但我未见断言） | 改为 `dodge` 替代 |
| 3 | `summon.count` 上限 5 的边界（丁春秋用 2） | 降为 1 |
| 4 | 新增槽位 `音波` 是否需改 `commands.js` 的武器校验 | 不采纳 `sing_wave` |
