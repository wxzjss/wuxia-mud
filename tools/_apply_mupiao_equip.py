#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_mupiao_equip.py —— 木瓢数据侧两处（2026-10-15，游有方）
----------------------------------------------------------------
主人真机件 4（木瓢）的数据侧配套，引擎侧（equipSlots 手持槽可见 +
modapi {equip:"物品id"} 条件键）已由寇豆码落。本脚本改 50_map road_jiangnan_1 倒水：

① cond 两态都通：瓢在背包（翻案底摸的）或已装备都放行——
   {"flag","notFlag","or":[{item:mu_piao},{equip:mu_piao}]}
   （原裸 item 键只查背包，装备中的瓢已离包，永远判假=装备后反而不能倒水）
② 演出按两态分流（type:cond + if/else，jiangnan_temple / beijiang_shankou 先例）：
   · if {item}（瓢在身上）→ 原文案「从案底下摸出木瓢」逐字保留
   · else（已持瓢）→ 新开场「抬手把木瓢抄在手里」，缝里塞布的细节两态共用
     （不让玩家明明拿着瓢还「从案底下摸」）
   · 后三句（舀了十几下/缸轻了/缸变滑了）+ 置旗逐字不动
③ 全库 {item:X} cond 盘点（收口）：打铁(iron_ore×5)/交差四件（herb/wine/roast/venom）
   是纯消耗 item 口径正确；yamen_pass/palace_token 三处出口令牌无 slot 不可装备
   无同病——倒水是唯一「持械语义」处，与寇豆码扫描结论一致，他处不动。
幂等：内容比对，两连跑 OK。写盘口径：50_map indent=2 + 尾换行（与现盘一致）。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')

P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

NEW_COND = {"flag": "act1_vat_look", "notFlag": "act1_vat_pour",
            "or": [{"item": "mu_piao"}, {"equip": "mu_piao"}]}
THEN_LINE = "你从案底下摸出那只木瓢，瓢把上裂了道缝，缝里塞着一小块布。"
ELSE_LINE = "你抬手把木瓢抄在手里。瓢把上裂了道缝，缝里塞着一小块布。"
SHARED = [
    "你舀了十几下，水面下去一半。地上一片湿，湿到灶膛口，湿土的颜色变深，踩上去有点粘鞋。",
    "缸轻了。",
    "缸变滑了。你第二次伸手的时候，手掌在缸壁上打了个滑。",
]

d50 = read(P50)
acts = d50['rooms']['road_jiangnan_1']['actions']
pour = next(a for a in acts if a.get('cmd') == '倒水')

target = dict(pour)
target['cond'] = json.loads(json.dumps(NEW_COND, ensure_ascii=False))
target['effects'] = [
    {"type": "cond",
     "if": {"item": "mu_piao"},
     "then": [{"type": "narrate", "raw": THEN_LINE}],
     "else": [{"type": "narrate", "raw": ELSE_LINE}]},
] + [{"type": "narrate", "raw": s} for s in SHARED] + [
    {"type": "flag", "args": ["act1_vat_pour"]},
]

if pour != target:
    acts[acts.index(pour)] = target
    write(P50, d50)
    print('OK: 50_map 倒水（cond or[item,equip] 两态 + 演出 if/else 分流）')
else:
    print('OK（已落，跳过）: 50_map 倒水')

# ---------- 断言 ----------
v50 = read(P50)
p2 = next(a for a in v50['rooms']['road_jiangnan_1']['actions'] if a.get('cmd') == '倒水')
c = p2['cond']
assert c.get('flag') == 'act1_vat_look' and c.get('notFlag') == 'act1_vat_pour', '旗标门被动了'
assert 'item' not in c, '裸 item 键没摘（装备态仍会判假）'
orr = c.get('or') or []
assert {'item': 'mu_piao'} in orr and {'equip': 'mu_piao'} in orr and len(orr) == 2, 'or 两态不对'
eff = p2['effects']
assert eff[0].get('type') == 'cond' and eff[0]['if'] == {'item': 'mu_piao'}, '分流头不对'
assert eff[0]['then'][0]['raw'] == THEN_LINE, '背包态原文案被改'
assert eff[0]['else'][0]['raw'] == ELSE_LINE, '装备态新开场没落'
assert [e['raw'] for e in eff[1:4]] == SHARED, '共用三句被改'
assert eff[4] == {"type": "flag", "args": ["act1_vat_pour"]}, '置旗被动了'
assert p2.get('failMsg', '').startswith('你用喝茶那只碗舀'), 'failMsg 被动（碗文案两态外兜底，保留）'
assert p2.get('next') == '翻案底', 'next 被动'
assert '——' not in json.dumps(p2, ensure_ascii=False), '破折号混入'
print('断言全过：cond or 两态 / 背包态原文逐字 / 装备态新开场 / 共用三句+置旗+failMsg+next 原样 / 无破折号')
