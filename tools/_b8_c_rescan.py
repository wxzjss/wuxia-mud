# -*- coding: utf-8 -*-
"""C 类复扫（修正口径）：30_sects 中同一功法可挂多门（共享按设计）。
own = 该功法挂的所有门派集合；错配 = NPC.sect 不在其功法归属集合内。"""
import json, collections, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')
def L(f): return json.load(open(os.path.join(D, f), encoding='utf-8'))
sk = L('10_skills.json')['skills']; sc = L('30_sects.json')['sects']
own_multi = collections.defaultdict(set)
for sn, s in sc.items():
    for a in s.get('skills', []):
        own_multi[a].add(sn)
    for r, lst in s.get('rankSkills', {}).items():
        for a in lst:
            own_multi[a].add(sn)

all_n = {}
for f in ['40_npcs', '42_sect_guards', '43_sect_disciples', '99_city_npcs', '101_classic_npcs', '79_culture_npcs', '77_npc_martial']:
    d = L(f + '.json'); d = d.get('npcs', d)
    for k, v in d.items():
        v = dict(v); v['_src'] = f; v['_key'] = k
        all_n[k] = v

bad = []
for n in all_n.values():
    s = n.get('sect')
    for a in (n.get('learned') or {}):
        if a in sk and own_multi.get(a) and s not in own_multi[a]:
            bad.append((n['_key'], n['_src'][:2], s or '(无sect)', a, sorted(own_multi[a])))
print('真错配（多门归属口径）:', len(bad), '处 /', len(set(b[0] for b in bad)), '人')
for b in bad:
    print('  ', b)
print()
print('=== 共享功法一览（挂≥2门的库内功法）===')
for a, ss in sorted(own_multi.items()):
    if len(ss) > 1:
        print('  %-18s %s' % (a, sorted(ss)))
