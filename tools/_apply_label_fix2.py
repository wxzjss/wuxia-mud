#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_label_fix2.py —— label/cmd 残余（第二刀，2026-10-18）
----------------------------------------------------------------
当前树复跑 `_audit_label_cmd_export` 后 cmd 列剩 9 条，全在 50_map：
  ① 5 条是**被 62_shops 整段覆盖后失去的真动作**（都带 quest cond，是支线指路/打听）
     → 按「挂最后定义该房且带 actions 键的分片」纪律**搬进 62**；
  ② 5 条是**名字对不上/已被 62 等价动作取代**（ask 算命先生 / ask 夫子 / talk 老鸨 /
     talk 郎中 / ask 脚夫）→ 从 50 删掉（62 已有 ask 徐半仙 / ask 陆见山 / talk 苗春 /
     talk 陈济仁 / ask 王大壮，且都补过 effects）。
writer 走 _canon_write（按基线格式）。幂等：两连跑第二遍「改动 0」。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

d50 = read('50_map.json')
d62 = read('62_shops.json')

MOVE = [
  ('jn_teahouse', '问楼里旧事'),
  ('jn_wine_house', '问那坛酒'),
  ('jn_school', '问门房'),
  ('jn_school', '问旧年学籍'),
  ('jn_harbor', '问开船的老船家'),
]
DROP = [
  ('jn_fortune', 'ask 算命先生 about 算命'),
  ('jn_school', 'ask 夫子 about 学问'),
  ('jn_brothel_gate', 'talk 老鸨'),
  ('jn_pharmacy', 'talk 郎中'),
  ('jn_harbor', 'ask 脚夫 about 搬运'),
]

dirty = set()

for rid, cmd in MOVE:
    src = next((a for a in (d50['rooms'][rid].get('actions') or []) if a.get('cmd') == cmd), None)
    if src is None:
        continue
    acts62 = d62['rooms'][rid].setdefault('actions', [])
    if not any(a.get('cmd') == cmd for a in acts62):
        acts62.append(json.loads(json.dumps(src)))
        dirty.add('62_shops.json')
    d50['rooms'][rid]['actions'] = [a for a in d50['rooms'][rid]['actions'] if a.get('cmd') != cmd]
    dirty.add('50_map.json')

for rid, cmd in DROP:
    acts = d50['rooms'][rid].get('actions') or []
    keep = [a for a in acts if a.get('cmd') != cmd]
    if len(keep) != len(acts):
        d50['rooms'][rid]['actions'] = keep
        dirty.add('50_map.json')

for fn, d in (('50_map.json', d50), ('62_shops.json', d62)):
    if fn in dirty:
        write_canon(os.path.join(DATA, fn), d)
print('改动分片:', sorted(dirty) or '（无）')

v50, v62 = read('50_map.json'), read('62_shops.json')
for rid, cmd in MOVE:
    a = next((x for x in v62['rooms'][rid]['actions'] if x.get('cmd') == cmd), None)
    assert a and a.get('cond') and a.get('effects'), f'{rid}·{cmd} 未搬进 62 或丢 cond/effects'
    assert not any(x.get('cmd') == cmd for x in (v50['rooms'][rid].get('actions') or [])), f'{rid}·{cmd} 50 里没删干净'
for rid, cmd in DROP:
    assert not any(x.get('cmd') == cmd for x in (v50['rooms'][rid].get('actions') or [])), f'{rid}·{cmd} 未删'
print('断言全过：5 条 quest 动作搬进 62（cond/effects 保留）+ 5 条重名死颗从 50 删除')
