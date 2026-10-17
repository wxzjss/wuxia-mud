#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sect_gate_joinsect.py —— 29 个门派山门「拜入门下」补 joinSect
----------------------------------------------------------------
症状（qa-lead 阻断级）：`73_sects_place.json` 的 `*_gate` 里，
`{label:'拜入门下', cmd:'拜师 <门派>', effects:[narrate 一句]}` **没有 joinSect** ——
在唯一看得见的拜师按钮上点下去，p.sect 仍是 null；走开一步再敲命令反而能入门。

修法（qa 方案 1）：effects 末尾补 `{"type":"joinSect","args":[sectId]}`。
joinSect 与命令走同一函数 → 门派门槛（性别/悟性/引荐信/叛门冷却）自动继承，不另写判据。

⚠️ 只补不删：原 narrate 保留；已带 joinSect 的跳过（幂等）。
⚠️ 落点：73_sects_place.json（该房 actions 的最后定义分片，先自检）。
"""
import json, io, os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

# 门派表（合并 30/72/74/84）
sects = {}
for fn in ('30_sects.json', '72_sects_tier.json', '74_martial_sects.json', '84_hehuan.json'):
    for k, v in (read(fn).get('sects') or {}).items():
        sects.setdefault(k, {}).update(v)

d73 = read('73_sects_place.json')
rooms = d73.get('rooms') or {}
dirty = False
added, skipped = [], []

for rid, r in sorted(rooms.items()):
    if not rid.endswith('_gate'):
        continue
    sect = rid[:-len('_gate')]
    if sect not in sects:
        continue
    for a in (r.get('actions') or []):
        cmd = a.get('cmd') or ''
        if not cmd.startswith('拜师'):
            continue
        effs = a.setdefault('effects', [])
        if any(e.get('type') == 'joinSect' for e in effs):
            skipped.append(rid)
            continue
        effs.append({"type": "joinSect", "args": [sect]})
        dirty = True
        added.append(f'{rid}->{sect}')

if dirty:
    write_canon(os.path.join(DATA, '73_sects_place.json'), d73)
print(f'补 joinSect：{len(added)} 处；已带跳过：{len(skipped)} 处')

# =====================================================================
# 断言 + 真走（引擎侧）
# =====================================================================
v = read('73_sects_place.json')
for rid, r in v['rooms'].items():
    if not rid.endswith('_gate'):
        continue
    sect = rid[:-len('_gate')]
    if sect not in sects:
        continue
    for a in (r.get('actions') or []):
        if (a.get('cmd') or '').startswith('拜师'):
            assert any(e.get('type') == 'joinSect' and e.get('args') == [sect] for e in (a.get('effects') or [])), \
                f'{rid} 仍缺 joinSect({sect})'
print('静态断言全过：所有门派山门的「拜师」动作都带本派 joinSect')
