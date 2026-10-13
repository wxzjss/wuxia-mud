# -*- coding: utf-8 -*-
"""B8 C-1：40_npcs 散人错配功法替换（27 处 / 25 人）。幂等：字段存在性断言。"""
import json, shutil, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '40_npcs.json')
BAK = os.path.join(BASE, 'game', 'data', '40_npcs_bak_pre_b8c1.json')

REP = {  # old -> (new, slot_old -> slot_new or None)
    'kuangfeng_daofa': ('jh_blade', None),
    'huashan_sword': ('jh_sword', None),
    'dagou_bangfa': ('jh_staff', None),
    'weituo_zhang': ('jh_fist', None),
    'shaolin_bu': ('jh_dodge', None),
    'tangmen_anqi': ('jh_blade', '刀'),   # 无通用暗器，黑衣人改刀客位
}
TARGETS = ['npcv_013','npcv_016','npcv_017','npcv_027','npcv_049','npcv_050','npcv_081',
           'npcv_083','npcv_092','npcv_115','npcv_116','npcv_124','npcv_125','npcv_148',
           'npcv_149','npcv_158','npcv_181','npcv_182','npcv_214','npcv_215','npcv_224',
           'npcv_247','npcv_248','npcv_257','npcv_280','npcv_281','mob_assassin']

if not os.path.exists(BAK):
    shutil.copy2(P, BAK)
    print('backup ->', BAK)

d = json.load(open(P, encoding='utf-8'))
npcs = d['npcs']
n_learn = n_map = n_slot = 0
for k in TARGETS:
    n = npcs[k]
    ld = n.get('learned') or {}
    for old, (new, _) in REP.items():
        if old in ld:
            entry = ld.pop(old)
            ld[new] = entry            # 保留原 level/exp
            n_learn += 1
        skl = n.get('skills') or {}
        for slot, v in list(skl.items()):
            if v == old:
                del skl[slot]
                skl[slot if REP[old][1] is None else REP[old][1]] = new
                n_map += 1
# 幂等断言：目标 NPC 中不再含旧功法
for k in TARGETS:
    n = npcs[k]
    bad = [x for x in (n.get('learned') or {}) if x in REP]
    bad += [v for v in (n.get('skills') or {}).values() if v in REP]
    assert not bad, (k, bad)

# mob_assassin 特检：暗器位已改刀位
ma = npcs['mob_assassin']
assert 'jh_blade' in ma['learned'] and ma['skills'].get('刀') == 'jh_blade', ma['skills']

out = json.dumps(d, ensure_ascii=False, indent=1)
assert not out.endswith('\n')
open(P, 'w', encoding='utf-8', newline='').write(out)
print('learned 替换 %d 处, skills 映射替换 %d 处（其中改槽位 1）' % (n_learn, n_map))
assert (n_learn, n_map) in ((27, 27), (0, 0)), (n_learn, n_map)
print('C-1 done: 27 处 / 25 人')
