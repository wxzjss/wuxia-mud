#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_xiake_errand_fix2.py —— 侠客岛差事改挂「真岛民鲍归」（改法二定案）
----------------------------------------------------------------
上一版（fix1）把差事改挂 `disciple_xiake_2`（阿朱阿碧），结果 `xiake_dukou` 里她**不生成实例**
（43 分片弟子不入 `_npcsByRoom`），交差报「这里没有人等待你的复命」。
定案走 lead 给的**改法二**：鲍归就是侠客岛收留的岛民——
  · 87_persona: sect='xiake'，rank=0（岛民）
  · 40_npcs: learned 补 `jiuyang_shengong`（等级 40，低阶入门），skills 内功挂上
  · 差事 giver 指回 npcv_080，并把 quest 挂回他的 quests
  · disciple_xiake_2 的 quests 撤掉
这样 identity（门派名+ranks[0]）与 lore（会一门本派武学）两红一起消，且差事在能生成的 NPC 手上。
幂等：两连跑无改动。
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
GIVER = 'npcv_080'

d40, d43, d67, d87 = (read('40_npcs.json'), read('43_sect_disciples.json'),
                      read('67_sidequests2.json'), read('87_persona.json'))
changed = 0

# 1) 鲍归：学了九阳入门 + 内功槽 + 差事
b = d40['npcs'][GIVER]
lr = b.setdefault('learned', {})
if 'jiuyang_shengong' not in lr:
    lr['jiuyang_shengong'] = {"level": 40, "exp": 0}
    changed += 1
sk = b.setdefault('skills', {})
if sk.get('内功') != 'jiuyang_shengong':
    sk['内功'] = 'jiuyang_shengong'
    changed += 1
ql = b.get('quests') if isinstance(b.get('quests'), list) else []
if QID not in ql:
    ql.append(QID)
    b['quests'] = ql
    changed += 1

# 2) 87：身分定为侠客岛岛民（rank 0）
p87 = (d87.get('npcs') or {}).get(GIVER)
if isinstance(p87, dict):
    if p87.get('sect') != 'xiake':
        p87['sect'] = 'xiake'; changed += 1
    if p87.get('rank') != 0:
        p87['rank'] = 0; changed += 1

# 3) 阿朱阿碧：撤掉差事
d2 = d43['npcs'].get('disciple_xiake_2') or {}
if isinstance(d2.get('quests'), list) and QID in d2['quests']:
    d2['quests'] = [q for q in d2['quests'] if q != QID]
    changed += 1

# 4) 差事 giver 指回鲍归
q = d67['quests'][QID]
if q.get('giver') != GIVER:
    q['giver'] = GIVER
    changed += 1

if changed:
    for fn, d in (('40_npcs.json', d40), ('43_sect_disciples.json', d43),
                  ('67_sidequests2.json', d67), ('87_persona.json', d87)):
        write_canon(os.path.join(DATA, fn), d)
print('改动：%d 处' % changed)

# ---------------- 断言（引擎合并口径） ----------------
FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
merged = {}
for fn in FILES:
    for k, n in (read(fn).get('npcs') or {}).items():
        if isinstance(n, dict):
            merged.setdefault(k, {}).update(n)
b = merged[GIVER]
sects = {}
for fn in ('30_sects.json', '72_sects_tier.json', '74_martial_sects.json'):
    for k, v in (read(fn).get('sects') or {}).items():
        sects.setdefault(k, {}).update(v)
x = sects['xiake']
assert b.get('sect') == 'xiake' and b.get('rank') == 0, '鲍归身份不对: %r/%r' % (b.get('sect'), b.get('rank'))
assert b['rank'] < len(x['ranks']), 'rank 越界'
arts = set(x.get('skills') or []) & set((b.get('learned') or {}))
assert arts, '鲍归仍不会本派武学'
assert QID in (b.get('quests') or []), '鲍归 未挂差事'
assert QID not in ((merged.get('disciple_xiake_2') or {}).get('quests') or []), '阿朱阿碧 仍挂差事'
assert read('67_sidequests2.json')['quests'][QID]['giver'] == GIVER
print('断言全过：鲍归=侠客岛%s（rank0），会 %s；差事挂回本人' % (x['ranks'][0], '、'.join(sorted(arts))))

# ---------------- 同类扫净：门派守卫也补一门本派入门武学 ----------------
# 全库扫：有 sect 但 learned ∩ 本派武学 = ∅ 的还剩 2 个守卫——
#   sectguard_gaibang 丐帮弟子（可补 gaibang_atk_1 入门棍 g7）
#   sectguard_xiake 侠客岛仆役（侠客岛池里只有九阳/九阴/独孤三门绝学，无入门档，**不给绝学**，留作结构性例外）
d42 = read('42_sect_guards.json')
g = (d42.get('npcs') or {}).get('sectguard_gaibang')
if isinstance(g, dict):
    ch = 0
    lr = g.setdefault('learned', {})
    if 'gaibang_atk_1' not in lr:
        lr['gaibang_atk_1'] = {"level": 40, "exp": 0}; ch += 1
    sk0 = g.setdefault('skills', {})
    if sk0.get('棍') != 'gaibang_atk_1':
        sk0['棍'] = 'gaibang_atk_1'; ch += 1
    if ch:
        write_canon(os.path.join(DATA, '42_sect_guards.json'), d42)
    print('丐帮守卫补入门棍：%d 处' % ch)
