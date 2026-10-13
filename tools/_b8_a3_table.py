# -*- coding: utf-8 -*-
"""B8 A-3：npc.level ↔ learned_max 基准表（分层锚点 + 离群名单）。只读。"""
import json, collections, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')
def L(f): return json.load(open(os.path.join(D, f), encoding='utf-8'))
sc = L('30_sects.json')['sects']
all_n = {}
for f in ['40_npcs', '42_sect_guards', '43_sect_disciples', '99_city_npcs', '101_classic_npcs', '79_culture_npcs', '77_npc_martial']:
    d = L(f + '.json'); d = d.get('npcs', d)
    for k, v in d.items():
        v = dict(v); v['_src'] = f; v['_key'] = k
        all_n[k] = v
def learned(n): return n.get('martial', {}).get('learned') or n.get('learned') or {}
def layer(n):
    r = n.get('rank')
    if r is not None and r >= 5: return '掌门级'
    if r == 4: return '长老级'
    if n['_src'] == '42_sect_guards': return '守卫'
    if n['_src'] == '43_sect_disciples': return '门派弟子'
    if n['_src'] == '101_classic_npcs': return '经典角色'
    return '城镇散人'
BAND = {'掌门级': (6, 10), '长老级': (4, 8), '经典角色': (6, 10),
        '守卫': (1, 3), '门派弟子': (1, 3), '城镇散人': (0.5, 2)}
stats = collections.defaultdict(lambda: [0, 0, 0, []])  # in, low, high, samples
for k, n in all_n.items():
    ld = learned(n); lv = n.get('level')
    if not ld or lv is None: continue
    mx = max(v['level'] for v in ld.values())
    lay = layer(n); lo, hi = BAND[lay]
    ratio = mx / lv
    s = stats[lay]
    if lo <= ratio <= hi: s[0] += 1
    elif ratio < lo:
        s[1] += 1
        if ratio < lo * 0.5: s[3].append((k, lv, mx, round(ratio, 2)))
    else:
        s[2] += 1
        if ratio > hi * 2: s[3].append((k, lv, mx, round(ratio, 2)))
print('层          锚点      区间内  偏低  偏高   严重离群(超半档外)')
for lay, (lo, hi) in BAND.items():
    s = stats[lay]
    print('%-8s  ×%s–%s   %4d  %4d  %4d   %d' % (lay, lo, hi, s[0], s[1], s[2], len(s[3])))
    for t in s[3][:10]:
        print('      离群:', t)
# 无 level 或无 learned 概况
print()
print('无 learned（全部）:', sum(1 for n in all_n.values() if not learned(n)))
print('有 learned 但无 level:', sum(1 for n in all_n.values() if learned(n) and n.get('level') is None))
