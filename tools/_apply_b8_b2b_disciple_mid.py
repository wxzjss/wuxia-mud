#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_b8_b2b_disciple_mid.py —— B8 B 刀② 补：每派 1–2 名弟子有**中阶**
----------------------------------------------------------------
team-lead 硬约束：「降档后别让某派出现弟子全是入门的断崖；每个门派至少 1–2 名弟子有中阶，
否则玩家入门后看不到『再往上练什么』的示范。」

现状（14 个有弟子名册的门派里）：华山的陆大有、少林的空见、峨眉的纪晓芙、古墓的裘千尺、
摩教的童百熊、侠客岛的周颠——这 6 派弟子通身入门（g7）或挂名绝学，**无一人有中阶**。
处置：每派取 `disciple_<sect>_0` 一名，换/补一门**本派中阶**：
  · 有 `<sect>_atk_2` 的 → 招式槽换成它（中阶 g4/g5）；
  · 侠客岛没有档位武学（池里只有三绝学）→ 补 `cn_iron_shirt`（金钟罩，招架 g5）作通用中阶。
learned 同步（等级沿用原槽或 120）。
幂等：已是中阶则跳过。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

SECTS = ['huashan', 'shaolin', 'emei', 'gumu', 'mojiao', 'xiake']

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

skills = {}
for fn in ('74_martial_sects.json', '10_skills.json', '75_content_extra.json'):
    for sid, s in (read(fn).get('skills') or {}).items():
        skills.setdefault(sid, {}).update(s)

d43 = read('43_sect_disciples.json')
changed = []

for sect in SECTS:
    for idx in (0, 1):
        nid = 'disciple_%s_%d' % (sect, idx)
        n = (d43.get('npcs') or {}).get(nid)
        if not isinstance(n, dict):
            continue
        sk = n.get('skills') or {}
        grades = [(skills.get(s) or {}).get('grade') for s in sk.values()]
        if any(isinstance(g, int) and 4 <= g <= 6 for g in grades):
            continue                      # 已有中阶
        mid = sect + '_atk_2'
        if mid in skills:
            # 换招式槽（优先 拳/剑/刀/棍/暗器，其次任意）
            slot = next((s for s in ('拳', '剑', '刀', '棍', '暗器', '鞭') if s in sk), None)
            if slot is None:
                continue
            old = sk[slot]
            sk[slot] = mid
            lr = n.get('learned') or {}
            old_lv = (lr.get(old) or {}).get('level') if isinstance(lr.get(old), dict) else None
            lr.pop(old, None)
            cap = (skills.get(mid) or {}).get('maxLevel') or 750
            lr[mid] = {"level": max(60, min(old_lv or 120, cap))}
            n['skills'], n['learned'] = sk, lr
            changed.append((nid, old, mid))
        else:
            # 侠客岛：通用中阶段（金钟罩）
            if '招架' not in sk and 'cn_iron_shirt' in skills:
                sk['招架'] = 'cn_iron_shirt'
                lr = n.get('learned') or {}
                lr['cn_iron_shirt'] = {"level": 120}
                n['skills'], n['learned'] = sk, lr
                changed.append((nid, '(无)', 'cn_iron_shirt'))
        break                              # 每派只补 1 名

if changed:
    write_canon(os.path.join(DATA, '43_sect_disciples.json'), d43)
print('补中阶弟子：%d 处' % len(changed))
for c in changed:
    print('  ', c[0], c[1], '→', c[2])

# ---------------- 断言 ----------------
FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
npcs = {}
for fn in FILES:
    for k, n in (read(fn).get('npcs') or {}).items():
        if isinstance(n, dict):
            npcs.setdefault(k, {}).update(n)
from collections import defaultdict
cov = defaultdict(int)
for nid, v in npcs.items():
    if not str(nid).startswith('disciple_'):
        continue
    sect = str(nid).split('_')[1] if '_' in str(nid) else ''
    gs = [(skills.get(s) or {}).get('grade') for s in (v.get('skills') or {}).values()]
    if any(isinstance(g, int) and 4 <= g <= 6 for g in gs):
        cov[sect] += 1
for sect in SECTS:
    assert cov[sect] >= 1, sect + ' 仍无中阶弟子'
print('断言全过：6 派都至少 1 名弟子持中阶（' + '、'.join('%s:%d' % (s, cov[s]) for s in SECTS) + '）')
