# -*- coding: utf-8 -*-
"""C-1 定位：25 个散人中，谁有内联 skill def / combat 映射 / teach 引用需要一并替换。"""
import json, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')
d = json.load(open(os.path.join(D, '40_npcs.json'), encoding='utf-8'))
npcs = d['npcs']
targets = {'npcv_013','npcv_016','npcv_017','npcv_027','npcv_049','npcv_050','npcv_081','npcv_083',
           'npcv_092','npcv_115','npcv_116','npcv_124','npcv_125','npcv_148','npcv_149','npcv_158',
           'npcv_181','npcv_182','npcv_214','npcv_215','npcv_224','npcv_247','npcv_248','npcv_257',
           'npcv_280','npcv_281','mob_assassin'}
bad = {'kuangfeng_daofa','huashan_sword','dagou_bangfa','weituo_zhang','shaolin_bu','tangmen_anqi'}
for k in sorted(targets):
    n = npcs[k]
    learn = list((n.get('learned') or {}).keys())
    skl = n.get('skills') or {}
    skl_defs = [s for s in skl if s in bad]
    skl_map = [(slot, v) for slot, v in skl.items() if v in bad]
    teach = [t for t in (n.get('teach') or []) if t in bad]
    print(k, '| learned:', [x for x in learn if x in bad],
          '| 内联def:', skl_defs, '| 映射:', skl_map, '| teach:', teach)
# 谁在别处定义了内联 def（全库范围）
print('=== 内联 def 归属 ===')
for k, n in npcs.items():
    skl = n.get('skills') or {}
    defs = [s for s in skl if isinstance(skl[s], dict) and s in bad]
    if defs:
        print('  ', k, defs)
