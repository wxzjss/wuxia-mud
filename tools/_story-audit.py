# -*- coding: utf-8 -*-
"""剧情一致性体检 v4：按 effect.type 分派正确的引用表
   v4 修复：分文件自带的局部表（items/rooms/npcs/skills/books）必须并入全局表，
            否则 61_sidequests.json 里自带的 5 个物品会被误报为缺口。
"""
import json, io, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'game', 'data')


def load(n):
    with io.open(os.path.join(D, n), encoding='utf-8') as f:
        return json.load(f)


def keys_of(fn, *sub):
    try:
        d = load(fn)
        for s in sub:
            d = (d.get(s) or {}) if isinstance(d, dict) else {}
        return set(d.keys()) if isinstance(d, dict) else set()
    except Exception:
        return set()


# ——— 全局表 ———
rooms = keys_of('50_map.json', 'rooms')
items = keys_of('20_items.json', 'items') | keys_of('20_items.json')
books = keys_of('10_skills.json', 'books')
npcs = (keys_of('40_npcs.json', 'npcs') | keys_of('99_city_npcs.json', 'npcs')
        | keys_of('101_classic_npcs.json', 'npcs'))
skills = keys_of('10_skills.json', 'skills') | keys_of('74_martial_sects.json', 'skills')

FILES = ['60_quests.json', '61_sidequests.json', '62_quests_city.json', '63_quests_sect.json',
         '65_mainline_act3.json', '66_mainline_act45.json', '98_mainline_expansion.json']

# ——— 先扫一遍：把各文件自带的局部表并进全局表 ———
for fn in FILES:
    try:
        d = load(fn)
    except Exception:
        continue
    for k, tgt in (('items', items), ('books', books), ('rooms', rooms),
                   ('npcs', npcs), ('skills', skills)):
        v = d.get(k)
        if isinstance(v, dict):
            tgt |= set(v.keys())

print('房间%d 物品%d 书%d NPC%d 武学%d' % (len(rooms), len(items), len(books), len(npcs), len(skills)))

MAP = {
    '+item': items, '-item': items,
    '+skill': skills, '-skill': skills,
    'combat': npcs, '+npc': npcs, 'spawn': npcs, 'npc': npcs,
}


def collect(q):
    out = []
    for i, st in enumerate(q.get('stages') or []):
        for e in (st.get('effects') or []):
            out.append((i, e))
        for t in (st.get('targets') or []):
            for e in (t.get('effects') or []):
                out.append((i, e))
    for e in (q.get('rewards') or []):
        out.append((-1, e))
    for e in (q.get('stageRewards') or []):
        out.append((-2, e))
    return out


def args_of(e):
    a = e.get('args')
    a = e.get('arg') if a is None else a
    return a if isinstance(a, list) else ([] if a is None else [a])


allbad = []
for fn in FILES:
    try:
        d = load(fn)
    except Exception:
        continue
    Q = d.get('quests') or {}
    if not Q:
        continue
    bad = []
    for qid, q in Q.items():
        if not isinstance(q, dict):
            continue
        for si, e in collect(q):
            t = e.get('type') or e.get('kind') or ''
            tbl = MAP.get(t)
            if tbl is None:
                continue
            a = args_of(e)
            if not a or not isinstance(a[0], str):
                continue
            if a[0] in ('*', 'self', 'player'):
                continue
            if a[0] not in tbl:
                bad.append((qid, si, t, a[0]))
    if bad:
        print('\n=== %s（%d 任务）→ %d 条可疑 ===' % (fn, len(Q), len(bad)))
        for x in bad[:30]:
            tag = {-1: 'rewards', -2: 'stageRewards'}.get(x[1], 'stage%s' % x[1])
            print('  ✘ %s  %s  %s «%s»' % (x[0], tag, x[2], x[3]))
    else:
        print('\n=== %s（%d 任务）→ 全通过 ✓' % (fn, len(Q)))
    allbad += bad

print('\n总可疑条数:', len(allbad))
if allbad:
    c = collections.Counter('%s «%s»' % (b[2], b[3]) for b in allbad)
    print('\n出现最多的：')
    for k, v in c.most_common(15):
        print('  %dx  %s' % (v, k))
