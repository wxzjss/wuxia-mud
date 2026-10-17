#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_b8_b2_beggar.py —— B8 B 刀第 2 段（实为 1 条）：瞎眼老丐 rank 修正
----------------------------------------------------------------
B8「低身份持绝学」40 条的真持者只有 1 个：`beggar_info 瞎眼老丐`（丐帮门人，rank 0，
却会降龙十八掌 + 打狗棒法，修为 120）。他不是「小弟子会绝学」，是**丐帮隐世长老**。
⇒ 升 rank 0 → 4（长老档），与身份对得上，绝学随之合法。
（另外 38 条是「绝学只练到低修为」的挂名未成，见 109 档 §口径补充，不改数据。）
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

d40 = read('40_npcs.json')
n = d40['npcs']['beggar_info']
changed = 0
if n.get('rank') != 4:
    n['rank'] = 4
    changed += 1
if changed:
    write_canon(os.path.join(DATA, '40_npcs.json'), d40)
print('瞎眼老丐 rank 修正：%d 处' % changed)

v = read('40_npcs.json')['npcs']['beggar_info']
assert v.get('rank') == 4, 'rank 未生效'
print('断言全过：beggar_info rank=4（长老档），降龙/打狗 与其身份相符')
