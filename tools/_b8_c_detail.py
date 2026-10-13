# -*- coding: utf-8 -*-
import json, collections, os, pickle
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')
def L(f): return json.load(open(os.path.join(D, f), encoding='utf-8'))
sk = L('10_skills.json')['skills']; sc = L('30_sects.json')['sects']
out = pickle.load(open(os.path.join(BASE, 'tools', '_tmp_b8b.pkl'), 'rb'))
C = out['C']
none_in_lib = [c for c in C if c[4] not in sk]
print('C 中不在 10_skills 库的功法 id:', len(none_in_lib), '处 /', len(set(c[0] for c in none_in_lib)), '人')
ids = collections.Counter(c[4] for c in none_in_lib)
print('  ids:', dict(ids))
in_lib = [c for c in C if c[4] in sk]
print('C 中在库的:', len(in_lib), '处 /', len(set(c[0] for c in in_lib)), '人')
for c in in_lib:
    print('  ', c)

# 30_sects 是否有 xuedao 门派
print('sects keys:', list(sc.keys()))
# 守卫层 learned 概览
g = pickle.load(open(os.path.join(BASE, 'tools', '_tmp_b8b.pkl'), 'rb'))
