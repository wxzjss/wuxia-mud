#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sect_errands_v3.py —— 差事恢复「两段」节奏（设计口径，不是量具口径）
----------------------------------------------------------------
背景：v2 曾把差事压成单段（stage0.next=99），起因是 qa 旧探针只交一次差；qa 已把
探针改成**逐段循环**，并明确：**别为配合量具改被测物**。本脚本把 35 条恢复成设计节奏：
  stage0：做事（room/kill/item 目标），next 1
  stage1：回山门复命，next 99
（team-lead 114 施工单原文：S3 简化·接案+收束两段。）
幂等：已是两段则跳过。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

d67 = read('67_sidequests2.json')
qs = d67.get('quests') or {}
fixed = 0
for qid, q in qs.items():
    if not qid.startswith('q_sect_') or not qid.endswith('_errand'):
        continue
    stages = q.get('stages') or []
    if len(stages) >= 2:
        continue
    st0 = dict(stages[0] or {})
    # 去掉 v2 追加的「；回山门复命」尾巴，把它还原成第二段
    desc0 = (st0.get('desc') or '').rstrip()
    if desc0.endswith('；回山门复命'):
        desc0 = desc0[:-len('；回山门复命')]
    st0['desc'] = desc0
    st0['next'] = 1
    q['stages'] = [st0, {"desc": "回山门复命", "next": 99}]
    fixed += 1

if fixed:
    write_canon(os.path.join(DATA, '67_sidequests2.json'), d67)
print('恢复两段：%d 条' % fixed)

v = read('67_sidequests2.json')['quests']
n = 0
for qid, q in v.items():
    if qid.startswith('q_sect_') and qid.endswith('_errand'):
        assert len(q['stages']) == 2, qid + ' 不是两段'
        assert q['stages'][0]['next'] == 1 and q['stages'][1]['next'] == 99, qid + ' 段接不对'
        n += 1
print('断言全过：%d 条差事为两段（做事 → 回山门复命）' % n)
