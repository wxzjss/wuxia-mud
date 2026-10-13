# -*- coding: utf-8 -*-
import pickle, json, collections, os, sys
BASE = os.path.dirname(os.path.abspath(__file__))
d = pickle.load(open(os.path.join(BASE, '_tmp_b8b.pkl'), 'rb'))['all_n']
for k in ['master_yue','shaolin_fangzheng','gaibang_hong','xiao_feng','disciple_gaibang_0','nv_huang','mob_tiger','npcv_013','jn_tutor','blood_saber','wen_black','beggar_info']:
    n = d.get(k)
    if n:
        print(k, '|src', n['_src'], '|title', n.get('title'), '|role', n.get('role'), '|sect', n.get('sect'), '|rank', n.get('rank'), '|lv', n.get('level'), '|keys', [x for x in n.keys() if x not in ('talk', 'desc')])
d43 = [v for v in d.values() if v['_src'] == '43_sect_disciples']
print('--- D43 samples:')
for n in d43[:5]:
    print('D43', n['_key'], 'sect', n.get('sect'), 'rank', n.get('rank'), 'title', n.get('title'))
print('--- field coverage by src:')
c = collections.Counter((v['_src'], 'rank' in v, 'sect' in v, 'title' in v) for v in d.values())
for k, v in sorted(c.items()):
    print(k, v)
