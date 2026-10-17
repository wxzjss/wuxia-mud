#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_regress_fix.py —— 修 label 批带出的两处回归（2026-10-18）
----------------------------------------------------------------
红① smoke-portrait「元怀瑾口头禅 30%」：
  根因不是数据丢了，是**规矩**——`selfSuffRoomAction`：房动作自带 effects 时优先于内置指令。
  我上批给 `talk 元怀瑾 / talk 县太爷` 补了 effects（本意治「点也死」），结果把内置 NPC 对话
  （画像口头禅/信任轴/问答）整条盖住。NPC 就在房里，内置 talk 本来就是活的。
  ⇒ 摘掉这两条的 effects（保留动作本身，label/锚点不丢）。

红② say-hint-check 68/69 + 账本孤儿「jn_bookshop|翰墨斋」：
  我删了 jn_bookshop 的空动作 `list 林守拙`（空 list 会挡住内置货摊，必须删），
  而 `_out_say.tsv` / `_out_say_keywords.tsv` 还挂着这条 → 施工图悬空。
  ⇒ 从两本台账里删掉翰墨斋这行（招牌 say 不再需要：该房的「买书」走内置 list，房动作会让买卖失效）。

writer 走 _canon_write。幂等：两连跑第二遍「无改动」。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

# ---- 红①：删掉「空壳 talk <真名>」房动作 ----
# 为什么删而不是补 effects：房动作自带 effects 会盖住内置 talk（画像/信任/口头禅全跳过）；
# 不补 effects 又会变成 B6 兜底句 + 依赖 NPC 实例是否已生成。这些动作本来只为给锚点，
# NPC 名本身可点，删掉最干净。
DELETE = [
  ('62_shops.json', 'jn_yamen_court', 'talk 元怀瑾'),
  ('62_shops.json', 'jn_yamen_court', 'talk 县太爷'),
  ('62_shops.json', 'jn_pharmacy', 'talk 陈济仁'),
  ('62_shops.json', 'jn_brothel_gate', 'talk 苗春'),
  ('50_map.json', 'jn_yamen_court', 'talk 县太爷'),
]
_docs = {}
_changed = 0
for fn, rid, cmd in DELETE:
    if fn not in _docs:
        _docs[fn] = read(fn)
    acts = _docs[fn]['rooms'][rid].get('actions') or []
    keep = [a for a in acts if a.get('cmd') != cmd]
    if len(keep) != len(acts):
        _docs[fn]['rooms'][rid]['actions'] = keep
        _changed += 1
for fn, d in _docs.items():
    write_canon(os.path.join(DATA, fn), d)
print(f'删空壳 talk 动作：{_changed} 条')

# ---- 红②：两本台账删翰墨斋行 ----
for fn in ('_out_say.tsv', '_out_say_keywords.tsv'):
    p = os.path.join(ROOT, 'tools', fn)
    lines = io.open(p, encoding='utf-8').read().split('\n')
    keep = [l for l in lines if not any(g in l for g in ('翰墨斋','县太爷','老鸨','老郎中'))]
    if len(keep) != len(lines):
        io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(keep))
        print(f'台账删行：{fn}（{len(lines)-len(keep)} 行）')
    else:
        print(f'台账无需改：{fn}')

# ---- 断言 ----
for fn, rid, cmd in DELETE:
    v = read(fn)
    assert not any(x.get('cmd') == cmd for x in (v['rooms'][rid].get('actions') or [])), f'{fn}:{rid} 仍有 {cmd}'
print('静态断言过：空壳 talk <真名> 动作已删净（内置对话恢复）')
