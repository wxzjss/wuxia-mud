#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_xiake_errand_fix.py —— 侠客岛差事改挂真岛民，鲍归恢复流民身份
----------------------------------------------------------------
lead-programmer 报两红都指向 `npcv_080 鲍归`：
  identity-check：门派 NPC 身份须 = 门派名 + ranks[rank]；他 rank 缺失
  lore-consistency：门派弟子至少要会一门本派武学；他只有 basic/jh 通用拳脚
根因是 114 我为满足 qa 的 B0/B2b（`giver.sect === id`）给鲍归补了 `sect:"xiake"`，
但他 title「流民」/ tag `refugee` —— 他不是侠客岛弟子。

修法：**不动他的身份**（删掉我们补的 sect、撤掉挂在他身上的差事），
把 `q_sect_xiake_errand` 改挂到真岛民 `disciple_xiake_2`（阿朱阿碧，xiake_dong 渡口，
rank 0「岛民」，会九阳/九阴）——差事文案本来就是「渡口的船要补钉」，落点更贴。
两红一起消，114 的 B0/B2b 也仍绿。

幂等：结构比对，两连跑无改动。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

QID = 'q_sect_xiake_errand'
OLD, NEW = 'npcv_080', 'disciple_xiake_2'

d40 = read('40_npcs.json')
d43 = read('43_sect_disciples.json')
d67 = read('67_sidequests2.json')
d87 = read('87_persona.json')
changed = 0

# 1) 鲍归：撤 quests + 恢复 sect:null（87 的标量会盖 40，故在 87 置 null）
old = d40['npcs']['npcv_080']
if isinstance(old.get('quests'), list) and QID in old['quests']:
    old['quests'] = [q for q in old['quests'] if q != QID]
    changed += 1
p87 = (d87.get('npcs') or {}).get('npcv_080')
if isinstance(p87, dict) and p87.get('sect') is not None:
    p87['sect'] = None
    changed += 1

# 2) 新 giver：disciple_xiake_2 挂差事
new = d43['npcs'][NEW]
ql = new.get('quests') if isinstance(new.get('quests'), list) else []
if QID not in ql:
    ql.append(QID)
    new['quests'] = ql
    changed += 1

# 3) 差事 giver 改指
q = d67['quests'][QID]
if q.get('giver') != NEW:
    q['giver'] = NEW
    changed += 1

if changed:
    for fn, d in (('40_npcs.json', d40), ('43_sect_disciples.json', d43),
                  ('67_sidequests2.json', d67), ('87_persona.json', d87)):
        write_canon(os.path.join(DATA, fn), d)
print('改动：%d 处' % changed)

# ---------------- 断言（含引擎合并口径） ----------------
FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
merged = {}
for fn in FILES:
    for k, n in (read(fn).get('npcs') or {}).items():
        if isinstance(n, dict):
            merged.setdefault(k, {}).update(n)
b = merged['npcv_080']
assert not b.get('sect'), '鲍归 sect 未恢复为空: %r' % b.get('sect')
assert QID not in (b.get('quests') or []), '鲍归 仍挂侠客岛差事'
g = merged[NEW]
assert g.get('sect') == 'xiake' and g.get('rank') == 0, '新 giver 身份不对'
sd = {}
for fn in ('30_sects.json', '72_sects_tier.json', '74_martial_sects.json'):
    for k, v in (read(fn).get('sects') or {}).items():
        sd.setdefault(k, {}).update(v)
arts = set(sd['xiake'].get('skills') or [])
assert arts & set((g.get('learned') or {})), '新 giver 不会本派武学'
assert read('67_sidequests2.json')['quests'][QID]['giver'] == NEW
print('断言全过：鲍归恢复流民；差事改挂 %s（岛民 rank0，会 %s）' %
      (NEW, '、'.join(sorted(arts & set((g.get('learned') or {}))))))
