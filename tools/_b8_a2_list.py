# -*- coding: utf-8 -*-
"""A-2 名单：高位（掌门级/经典角色）无 learned 的 NPC，判功能（可教/可切磋/任务/商店/纯对话）。"""
import json, os, collections
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
def rank5(n):
    r = n.get('rank'); return r is not None and r >= 5
for k, n in sorted(all_n.items()):
    if learned(n): continue
    is_high = rank5(n) or n['_src'] == '101_classic_npcs'
    if not is_high: continue
    teach = n.get('teach'); hostile = n.get('hostile')
    has_q = bool(n.get('quests') or n.get('sidequest'))
    shop = bool(n.get('shop') or n.get('carry'))
    print('%-18s %-4s sect=%-8s rank=%-4s title=%-10s teach=%s hostile=%s quest=%s shop=%s ask=%s' % (
        k, n['_src'][:2], n.get('sect'), n.get('rank'), n.get('title'),
        bool(teach), hostile, has_q, shop, bool(n.get('ask') or n.get('askDefault'))))
