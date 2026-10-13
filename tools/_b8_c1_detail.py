# -*- coding: utf-8 -*-
"""C-1 前置：列出 10_skills 全部 60 条（id/name/type/category），列通用 jh_* 清单；
列出 C-1 的 27 处 NPC 明细（npc.level、现有 learned 全貌、tag/name）以定替换。"""
import json, os, pickle, collections
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')
def L(f): return json.load(open(os.path.join(D, f), encoding='utf-8'))
sk = L('10_skills.json')['skills']
print('=== 通用功法（30_sects 未挂任何门派的 25 条）===')
sc = L('30_sects.json')['sects']
for k, v in sk.items():
    o = '通用'
    for sn, s in sc.items():
        if k in s.get('skills', []) or k in s.get('rankSkills', {}):
            o = sn; break
    if o == '通用':
        print('  %-18s %-10s type=%-6s maxLv=%s' % (k, v.get('name'), v.get('type'), v.get('maxLevel')))
print('=== jh_* 全清单 ===')
for k, v in sk.items():
    if k.startswith('jh_') or k.startswith('basic_'):
        print('  %-18s %-10s type=%-6s cat=%s maxLv=%s' % (k, v.get('name'), v.get('type'), v.get('category'), v.get('maxLevel')))

out = pickle.load(open(os.path.join(BASE, 'tools', '_tmp_b8b.pkl'), 'rb'))
alln = pickle.load(open(os.path.join(BASE, 'tools', '_tmp_b8b.pkl'), 'rb')).get('all_n')
# _tmp_b8b v2 没有 all_n，重读
all_n = {}
for f in ['40_npcs', '42_sect_guards', '43_sect_disciples', '99_city_npcs', '101_classic_npcs', '79_culture_npcs', '77_npc_martial']:
    d = L(f + '.json'); d = d.get('npcs', d)
    for k, v in d.items():
        v = dict(v); v['_src'] = f; v['_key'] = k
        all_n[k] = v
print('=== C-1 明细（散人 27 处）===')
own = {}
for k in sk:
    o = '通用'
    for sn, s in sc.items():
        if k in s.get('skills', []) or k in s.get('rankSkills', {}):
            o = sn; break
    own[k] = o
seen = set()
for n in all_n.values():
    if n['_src'] != '40_npcs': continue
    s = n.get('sect'); ld = n.get('learned') or n.get('martial', {}).get('learned') or {}
    for a in ld:
        if a in sk and own[a] not in ('通用', s):
            if n['_key'] in seen: continue
            seen.add(n['_key'])
            print('  %-16s name=%-8s tag=%-8s level=%-4s learned=%s' % (
                n['_key'], n.get('name'), n.get('tag'), n.get('level'),
                {x: y.get('level') for x, y in ld.items()}))
