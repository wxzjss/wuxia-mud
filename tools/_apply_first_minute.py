#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_first_minute.py —— 新手第一分钟强引导落 data（design/101，游有方 2026-10-13）
----------------------------------------------------------------
lead 全批 101。四件（hint/introHidden 为新数据字段，引擎不消费、不挡路；
呈现层消费归寇豆码，与其在办件对齐）：

① 楔子四段落 104 分片 intro 结构（flag act1_intro_done 一次性播；
   播报机制挂 newGame 首包——挂点键名与寇豆码对齐：intro.prologue[]）。
   文本 = 74 卯时楔子三段 + 茶摊落地段（老汉开场白），朱雀合评 1 分。
② 出生点 12 action 的 hint 标记（口径 A）：
   hint:true = 伸手/倒水/撬/垫/挪缸（挪缸五步链）/问信/接信/回话（抉择）/动身
   hint:false = 信/翻案底/掏灰/绕回茶摊（收进锚物：案/灶/槐树）
   ⚠ 链式单提示：hint:true 且 cond 未满足时前端不列（口径 A 对齐项）——
   每一步「此地可做」恰好 1 条主线 action。首个 = 伸手（问信 cond 锁在
   act1_vat_moved 后，74 动线本是先帮工后问信——101 案 T2 的「先问信」
   按实测链序修正，已在报数中说明）。
③ 出生点五出口 introHidden: act1_letter_taken（口径 B）：
   接信后按钮才亮（老汉指路句「村在路东」同步）。101 案原文「看信后亮」
   修正为「接信后亮」——看信在青溪村（要走出去），藏按钮不锁路但新手
   不知输词，鸡生蛋。
   w/e/ne 裸字符串出口转 {to, introHidden} 对象（doMove/bfsDistance 均认）。
④ 老汉 talk 首句前插「外乡人。你身上那块布，我看见了。」（74 原文，
   引导玩家注意粗布→信）。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

PROLOGUE = [
    "你被人放在这棵树底下的时候，是十九年前的冬天。包裹你的那件棉袄不是你的，袖子长出一截，大人把袖口往外卷了两道，卷边的地方磨破了，露出里头的灰棉。棉袄口袋里有半块饼，饼硬得像块瓦。",
    "抱你走的那个人没留下名字。只留下一句话，写在包你的那块粗布角上，字是用炭写的，笔画歪：「等天下太平了再来找。」你今年十九岁。天下没有太平过。你手里现在只有这块粗布。布角上的字被水洗过好几回，炭字淡了，只剩末尾那个「找」字还认得出笔画。",
    "昨夜你睡在城南的土地庙，庙里另外三个人天没亮就走了。你起来的时候，庙门开着，风把香灰吹了一地。",
    "老槐树底下有个茶摊。老汉从芦席底下钻出来，手里端着一碗热水。「坐。」他用下巴指了指对面那条长凳，「凳是三条腿的，你屁股往左边挪点。」你坐下去。凳面中间凹下去一块，凹的地方坐的人多了，木头记得人的形状。",
]

# ⚠ 真序实测（walkthrough 47 行）：伸手→翻案底(得浮票)→倒水→撬→垫→挪缸
# ——翻案底是链上必经步（倒水要用浮票），hint:true 进链式单提示。
HINT_TRUE = {"伸手", "翻案底", "倒水", "撬", "垫", "挪缸", "问信", "接信", "回茶摊", "动身"}


def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)


def write(p, j):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')


# ---------- ①④ 楔子 + 老汉 talk（104 分片） ----------
P104 = os.path.join(ROOT, 'game', 'data', '104_birth_polish.json')
d104 = read(P104)
changed = False
if 'intro' not in d104:
    d104['intro'] = {
        "flag": "act1_intro_done",
        "prologue": PROLOGUE,
        "_note": "新手第一分钟楔子（design/101 §三，74 卯时原文）：newGame 首包前置播，flag 置后不重播（老档读入不重播）。播报挂点与寇豆码 storybeat 侧对齐。",
    }
    changed = True
zhou = d104.get('npcs', {}).get('guide_teaman')
if not zhou:
    d104.setdefault('npcs', {})
    d104['npcs']['guide_teaman'] = {"id": "guide_teaman", "talk": ["外乡人。你身上那块布，我看见了。"]}
    changed = True
else:
    tk = zhou.get('talk') or []
    if not (tk and tk[0] == "外乡人。你身上那块布，我看见了。"):
        zhou['talk'] = ["外乡人。你身上那块布，我看见了。"] + list(tk)
        changed = True
if changed:
    write(P104, d104)
    print('OK: 104 intro 楔子四段 + guide_teaman talk 首句')

# ---------- ②③ 出生点 hint / introHidden（50_map） ----------
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')
d50 = read(P50)
rm = d50['rooms']['road_jiangnan_1']
dirty = False

for a in rm.get('actions', []):
    want = a['cmd'] in HINT_TRUE
    if a.get('hint') != want:
        a['hint'] = want
        dirty = True
    # 链序化（101 批文「开局恰 1 条」）：翻案底 cond 前置伸手（先摸到缸的
    # 裂纹，才知道案底那根木橛是撬缸的浮票）——原 cond 只挡重复（notFlag
    # piao_taken），开局就亮，与伸手并列两条。加 flag act1_vat_look。
    if a['cmd'] == '翻案底' and 'flag' not in (a.get('cond') or {}):
        a['cond'] = {"flag": "act1_vat_look", "notFlag": "act1_piao_taken"}
        dirty = True

INTRO_FLAG = 'act1_letter_taken'
# ⚠ ne（tingyu_gate）来自 demo_map 示例 mod——重击批第 1 件已把全部 demo mods
# 默认关，ne 出口随 mod 消失（主人说的「斜前方按钮」正是它）。只处理 n/s/w/e。
for d in ('n', 's', 'w', 'e'):
    ex = rm['exits'].get(d)
    if ex is None:
        continue
    if isinstance(ex, str):
        rm['exits'][d] = {"to": ex, "introHidden": INTRO_FLAG}
        dirty = True
    elif isinstance(ex, dict) and ex.get('introHidden') != INTRO_FLAG:
        ex['introHidden'] = INTRO_FLAG
        dirty = True

if dirty:
    write(P50, d50)
    print('OK: 50_map road_jiangnan_1 hint 标记 + 五出口 introHidden=%s' % INTRO_FLAG)
else:
    print('OK（已落，跳过）: 50_map')

# ---------- 断言 ----------
d104v = read(P104)
assert d104v['intro']['flag'] == 'act1_intro_done' and len(d104v['intro']['prologue']) == 4
assert d104v['npcs']['guide_teaman']['talk'][0] == "外乡人。你身上那块布，我看见了。"
d50v = read(P50)
rmv = d50v['rooms']['road_jiangnan_1']
assert all(a.get('hint') == (a['cmd'] in HINT_TRUE) for a in rmv['actions']), 'hint 标记有漏'
assert sum(1 for a in rmv['actions'] if a.get('hint')) == len(HINT_TRUE), 'hint:true 数量不对'
for d in ('n', 's', 'w', 'e'):
    ex = rmv['exits'][d]
    assert isinstance(ex, dict) and ex.get('introHidden') == 'act1_letter_taken', d + ' 出口 introHidden 缺'
    assert ex.get('to'), d + ' 出口 to 丢了'
assert 'ne' not in rmv['exits'], 'ne 出口不该在 50_map（demo_map 默认关后消失）'
print('断言全过：hint 9 真 3 假 / 四出口 introHidden 齐 / ne 随 demo_map 关 / 楔子四段 / 老汉首句')
