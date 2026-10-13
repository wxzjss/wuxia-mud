# -*- coding: utf-8 -*-
"""B8 盘点 v2（只读）：按 sect+rank 正确切层，产三类问题清单。"""
import json, collections, pickle, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, 'game', 'data')

def L(f):
    return json.load(open(os.path.join(D, f), encoding='utf-8'))

sk = L('10_skills.json')['skills']
sc = L('30_sects.json')['sects']

own = {}
for k in sk:
    o = '通用'
    for sn, s in sc.items():
        if k in s.get('skills', []) or k in s.get('rankSkills', {}):
            o = sn
            break
    own[k] = o

files = ['40_npcs', '42_sect_guards', '43_sect_disciples', '99_city_npcs',
         '101_classic_npcs', '79_culture_npcs', '77_npc_martial']
all_n = {}
for f in files:
    d = L(f + '.json')
    d = d.get('npcs', d)
    for k, v in d.items():
        v = dict(v)
        v['_src'] = f
        v['_key'] = k
        all_n[k] = v

def learned(n):
    return n.get('martial', {}).get('learned') or n.get('learned') or {}

def max_lv(n):
    return max([s.get('level', 0) for s in learned(n).values()], default=0)

def tot_lv(n):
    return sum(s.get('level', 0) for s in learned(n).values())

def layer(n):
    rank = n.get('rank')
    if n['_src'] == '101_classic_npcs':
        return '掌门级' if (rank is not None and rank >= 5) else '经典角色'
    if rank is not None:
        if rank >= 5:
            return '掌门级'
        if rank == 4:
            return '长老级'
        if n['_src'] == '42_sect_guards':
            return '守卫'
        if n['_src'] == '43_sect_disciples':
            return '门派弟子'
    if n['_src'] == '42_sect_guards':
        return '守卫'
    if n['_src'] == '43_sect_disciples':
        return '门派弟子'
    return '城镇散人'

cnt = collections.Counter(layer(n) for n in all_n.values())
print('=== 分层（v2, sect+rank 口径）:')
for k, v in cnt.most_common():
    print('  ', k, v)

out = {'layers': cnt}

# ---- A 类：功法与身份不配（数值倒挂为主）----
A_mis = []   # npc.level 与 learned max level 倒挂（差 > 30）
A_low = []   # 掌门/长老最高功法等级过低
for n in all_n.values():
    ld = learned(n)
    if not ld:
        continue
    lay = layer(n)
    ml = max_lv(n)
    npl = n.get('level')
    if npl is not None and ml - npl > 30:
        A_mis.append((n['_key'], n['_src'][:2], 'npc.level=%s learned_max=%d' % (npl, ml)))
    if lay in ('掌门级', '长老级') and ml < 200:
        A_low.append((n['_key'], n['_src'][:2], lay, 'npc.level=%s learned_max=%d' % (npl, ml), list(ld)[:4]))
print('=== A1 身份与功法强度不配：learned_max 比 npc.level 高 30+ 的:', len(A_mis))
for a in A_mis[:15]:
    print('  ', a)
print('=== A2 掌门/长老 learned_max<200 的:', len(A_low))
for a in A_low:
    print('  ', a)
out['A_mis'], out['A_low'] = A_mis, A_low

# ---- B 类：同门梯度乱 ----
B = []
by_sect = collections.defaultdict(list)
for n in all_n.values():
    s = n.get('sect')
    if s and s in sc and layer(n) in ('门派弟子', '守卫'):
        by_sect[s].append(n)
for s, lst in by_sect.items():
    rows = sorted(lst, key=lambda n: n.get('rank', -1))
    for i in range(1, len(rows)):
        hi, lo = rows[i], rows[i - 1]
        if hi.get('rank', 0) > lo.get('rank', 0) and tot_lv(hi) < tot_lv(lo):
            B.append((s, '%s(rank%s,tot%d)' % (lo['_key'], lo.get('rank'), tot_lv(lo)),
                         '%s(rank%s,tot%d)' % (hi['_key'], hi.get('rank'), tot_lv(hi))))
print('=== B 同门梯度倒挂:', len(B))
for b in B:
    print('  ', b)
# 顺带：掌门级 vs 本门最高弟子的落差
out['B'] = B

# ---- C 类：非本门拿专属 ----
C = []
for n in all_n.values():
    s = n.get('sect')
    lay = layer(n)
    for a in learned(n):
        o = own.get(a)
        if o != '通用' and o != s:
            C.append((n['_key'], n['_src'][:2], lay, s or '(无sect)', a, o))
print('=== C 非本门拿专属:', len(C), '处 /', len(set(c[0] for c in C)), '人')
combos = collections.Counter((c[3], c[4], c[5]) for c in C)
print('  按组合频次 top 15:')
for k, v in combos.most_common(15):
    print('  ', k, v)
by_lay = collections.Counter(c[2] for c in C)
print('  按身份层:', dict(by_lay))
out['C'] = C

# ---- 无 learned 一览 ----
no_ld = collections.Counter(layer(n) for n in all_n.values() if not learned(n))
print('=== 无 learned 按层:', dict(no_ld))
out['no_learned'] = no_ld

pickle.dump(out, open(os.path.join(BASE, 'tools', '_tmp_b8b.pkl'), 'wb'))
print('saved.')
