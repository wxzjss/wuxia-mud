#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_b8_b1_masters.py —— B8 B 刀第 1 段：掌门升档 + 守阁/看门身份修正
----------------------------------------------------------------
B8 盘点的「高身份只会入门」50 条，实际是两类人（先看清再动手）：
  · 20 位**小门派掌门**（`*_master`，rank 5）通身 `*_1` 入门四件套 → 真错配，**升档**：
      atk_1 → atk_3（本派绝学档，野派档位是 9/6/3）、force_1 → force_2、
      guard_1 → guard_2、fly_1 → fly_2（中阶）；
  · 30 位**守阁弟子/看门老头**（`*_keeper`，名字明明是守门人，rank 却被标成 4）→
      **不是升档问题，是身份标错**：rank 4 → 1（门人档）。给他们升到长老档才荒谬。
硬约束：掌门与首席弟子不许倒挂——升档后掌门 g3（绝学档）> 弟子 g9（入门），倒挂消除。
落点：掌门在 `73_sects_place.json`；keeper 在 `82_treasury_place.json`。
幂等：已是目标态则跳过。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

MASTERS = ['jindao_master','wuhu_master','feihu_master','zhenyuan_master','shenquan_master','tieqiang_master',
           'kuaidao_master','luohan_master','wuyun_master','dafeng_master','huanghe_master','taihu_master',
           'poyang_master','qingzhu_master','jujing_master','jinlong_master','wuliang_master','funiu_master',
           'baisheng_master','baituo_master']
KEEPERS = [k + '_keeper' for k in ('tangmen','taishan','hengshan','hengshanN','qingcheng','kongtong','kunlun',
           'diancang','tiezhang','hehuan','jindao','wuhu','feihu','zhenyuan','shenquan','tieqiang','kuaidao',
           'luohan','wuyun','dafeng','huanghe','taihu','poyang','qingzhu','jujing','jinlong','wuliang','funiu',
           'baisheng','baituo')]

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

# 技能表（查 maxLevel / grade）
skills = {}
for fn in ('74_martial_sects.json', '10_skills.json'):
    for sid, s in (read(fn).get('skills') or {}).items():
        skills.setdefault(sid, {}).update(s)

d73 = read('73_sects_place.json')
d82 = read('82_treasury_place.json')
changed = 0

def repl(sid, suffix):
    """把 <prefix>_atk_1 换成 <prefix>_atk_3 这类；不是目标形态返回 None"""
    if not sid.endswith('_1'):
        return None
    base = sid[:-2]           # 去掉 "_1"
    cand = base + suffix
    return cand if cand in skills else None

for mid in MASTERS:
    n = (d73.get('npcs') or {}).get(mid)
    if not isinstance(n, dict):
        continue
    sk = n.get('skills') or {}
    lr = n.get('learned') or {}
    new_sk, new_lr = dict(sk), dict(lr)
    for slot, sid in list(sk.items()):
        want = None
        if '_atk_' in sid:
            want = repl(sid, '_3')
        elif '_force_' in sid:
            want = repl(sid, '_2')
        elif '_guard_' in sid:
            want = repl(sid, '_2')
        elif '_fly_' in sid:
            want = repl(sid, '_2')
        if not want or want == sid:
            continue
        old_lv = (lr.get(sid) or {}).get('level')
        new_sk[slot] = want
        new_lr.pop(sid, None)
        if old_lv is not None:
            cap = (skills.get(want) or {}).get('maxLevel') or 900
            new_lr[want] = {"level": max(1, min(old_lv, cap))}
    if new_sk != sk or new_lr != lr:
        n['skills'] = new_sk
        n['learned'] = new_lr
        changed += 1

for kid in KEEPERS:
    n = (d82.get('npcs') or {}).get(kid)
    if isinstance(n, dict) and n.get('rank') != 1:
        n['rank'] = 1
        changed += 1

if changed:
    write_canon(os.path.join(DATA, '73_sects_place.json'), d73)
    write_canon(os.path.join(DATA, '82_treasury_place.json'), d82)
print('改动：%d 处（掌门 %d / keeper %d 组）' % (changed, len(MASTERS), len(KEEPERS)))

# ---------------- 断言（引擎合并口径） ----------------
FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
merged = {}
for fn in FILES:
    for k, n in (read(fn).get('npcs') or {}).items():
        if isinstance(n, dict):
            merged.setdefault(k, {}).update(n)

def max_grade_of(v):
    gs = [(skills.get(s) or {}).get('grade') for s in (v.get('skills') or {}).values()]
    gs = [g for g in gs if isinstance(g, int)]
    return min(gs) if gs else None   # 1 最高

for mid in MASTERS:
    v = merged[mid]
    g = max_grade_of(v)
    assert g is not None and g <= 6, '%s 仍无中阶以上（best=%r）' % (mid, g)
    assert g <= 3, '%s 掌门缺绝学档（best=%r）' % (mid, g)
for kid in KEEPERS:
    assert merged[kid].get('rank') == 1, '%s rank 未降到门人档（%r）' % (kid, merged[kid].get('rank'))
print('断言全过：%d 位掌门都有一门绝学档（≤g3）；%d 位 keeper rank=1' % (len(MASTERS), len(KEEPERS)))
