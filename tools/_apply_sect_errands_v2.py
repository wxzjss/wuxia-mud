#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sect_errands_v2.py —— 114-② 重整：单段收束 + giver.sect 接线
----------------------------------------------------------------
qa 的验收探针（tools/sect-batch114-accept.js）口径：
  B0 按 `giver.sect === <sect>` 认领差事 → 掌门必须带 sect 字段；
  B1 只跑一次「报事 <giver>」→ 差事必须**一次交差到 99**（我们原来是两段，需两次）。
本脚本把 35 条 `q_sect_<sect>_errand` 改成：
  · 单段：stage0（目标 + next 99），desc 里保留「回山门复命」的意头；
  · giver NPC 补 `sect`（写最后一个定义该 NPC 的分片，防数组/标量被后位覆盖）。
幂等：结构相同即跳过。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

GIVERS = {
  'jindao':'jindao_master','wuhu':'wuhu_master','kuaidao':'kuaidao_master','baisheng':'baisheng_master',
  'tieqiang':'tieqiang_master','tiezhang':'tiezhang_master','shenquan':'shenquan_master','luohan':'luohan_master',
  'xuedao':'blood_saber','mojiao':'mojiao_dongfang',
  'taishan':'taishan_master','hengshan':'hengshan_master','hengshanN':'hengshanN_master','qingcheng':'qingcheng_master',
  'kongtong':'kongtong_master','kunlun':'kunlun_master','diancang':'diancang_master','wuliang':'wuliang_master',
  'hehuan':'hehuan_master','wuyun':'wuyun_master','dafeng':'dafeng_master','funiu':'funiu_master','baituo':'baituo_master',
  'huanghe':'huanghe_master','taihu':'taihu_master','poyang':'poyang_master','qingzhu':'qingzhu_master',
  'jujing':'jujing_master','jinlong':'jinlong_master','feihu':'feihu_master','zhenyuan':'zhenyuan_master',
  'tangmen':'tangmen_master','gumu':'gumu_master','xingxiu':'xingxiu_laoxian','xiake':'npcv_080',
}

# ---- ① 差事改单段 ----
d67 = read('67_sidequests2.json')
qs = d67.get('quests') or {}
changed_q = 0
for sect, giver in GIVERS.items():
    qid = 'q_sect_%s_errand' % sect
    q = qs.get(qid)
    if not q:
        continue
    st0 = (q.get('stages') or [{}])[0]
    if st0.get('next') != 99:
        st0['next'] = 99
        changed_q += 1
    if q.get('stages') and len(q['stages']) > 1:
        q['stages'] = [st0]
        changed_q += 1
    # desc 保留复命意头（一次交差即收，文案不改玩法）
    if '；回山门复命' not in (st0.get('desc') or ''):
        st0['desc'] = (st0.get('desc') or '').rstrip('。') + '；回山门复命'
        changed_q += 1
if changed_q:
    write_canon(os.path.join(DATA, '67_sidequests2.json'), d67)
print('差事改单段：%d 处' % changed_q)

# ---- ② giver 补 sect（写最后一个定义该 NPC 的分片）----
FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
DOCS = {fn: read(fn) for fn in FILES}
hooked, touched = 0, set()
for sect, giver in GIVERS.items():
    target_fn, target_n = None, None
    for fn in FILES:
        n = (DOCS[fn].get('npcs') or {}).get(giver)
        if isinstance(n, dict):
            target_fn, target_n = fn, n
    if not target_fn:
        print('⚠️ giver 不存在:', giver)
        continue
    if target_n.get('sect') != sect:
        target_n['sect'] = sect
        hooked += 1
    touched.add(target_fn)
for fn in sorted(touched):
    write_canon(os.path.join(DATA, fn), DOCS[fn])
print('giver 补 sect：%d 处（分片 %d 个）' % (hooked, len(touched)))

# ---- 断言 ----
v = read('67_sidequests2.json')['quests']
for sect, giver in GIVERS.items():
    qid = 'q_sect_%s_errand' % sect
    q = v[qid]
    assert len(q['stages']) == 1 and q['stages'][0]['next'] == 99, qid + ' 不是单段收束'
    assert any(e.get('type') == '+contrib' for e in q['rewards']), qid + ' 缺 contrib'
# giver.sect 走引擎合并后的口径
import subprocess, json as _j
merged = {}
for fn in FILES:
    for k, n in (DOCS[fn].get('npcs') or {}).items():
        if isinstance(n, dict):
            merged.setdefault(k, {}).update(n)
for sect, giver in GIVERS.items():
    assert merged.get(giver, {}).get('sect') == sect, f'{giver} sect 未接通（{merged.get(giver,{}).get("sect")}）'
print('断言全过：35 条单段到 99 + giver.sect 接通')
