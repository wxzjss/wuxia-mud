#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sixstep_hide.py —— 出生点六步链 hideWhenFlag 标注（2026-10-15，游有方）
----------------------------------------------------------------
主人追加口径：「只能做一次且做过的事情不再显示」。
寇豆码在前端 hint 过滤里加了 hideWhenFlag 消费（引擎不消费、不挡路，
口径同 introHidden：值=旗标名字符串，做过即藏按钮）。
本脚本给出生点动作链的 13 个 once/单发动作逐个标注 hideWhenFlag，
全部指向**各自效果里已存在的完成旗标**（零新增 flag）：
  六步主链   伸手→倒水→撬→垫→挪缸（vat_look/pour/pry/wedge/moved）
  信件链     问信→接信（letter_known/taken）
  支线小件   翻案底(piao_taken) / 掏灰(fist_taught) / 带口信(msg_carried)
  分支动作   回茶摊(choice_done) / 动身(oldroad_seen) / 绕回茶摊(silent_seen)
  ——分支动作虽不在主人点名的六步里，但同属「做过即完成」族，一并标注
  （多标不伤：hideWhenFlag 只藏按钮，cond 照旧把门）。
幂等：内容比对，两连跑 OK。写盘口径：50_map indent=2 + 尾换行（与现盘一致）。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

# cmd -> 完成旗标（全部是动作自身 effects 里已存在的 flag，零新增）
HIDE_MAP = {
    '伸手': 'act1_vat_look',
    '倒水': 'act1_vat_pour',
    '撬': 'act1_vat_pry',
    '垫': 'act1_vat_wedge',
    '挪缸': 'act1_vat_moved',
    '翻案底': 'act1_piao_taken',
    '掏灰': 'act1_fist_taught',
    '问信': 'act1_letter_known',
    '接信': 'act1_letter_taken',
    '回茶摊': 'act1_choice_done',
    '动身': 'act1_oldroad_seen',
    '绕回茶摊': 'act1_silent_seen',
    '带口信': 'act1_msg_carried',
}

d50 = read(P50)
dirty50 = False
hit = []
for rid, r in (d50.get('rooms') or {}).items():
    for a in (r.get('actions') or []):
        cmd = a.get('cmd')
        if cmd not in HIDE_MAP:
            continue
        want = HIDE_MAP[cmd]
        if a.get('hideWhenFlag') != want:
            a['hideWhenFlag'] = want
            dirty50 = True
            hit.append(rid + '.' + cmd)

if dirty50:
    write(P50, d50)
    print('OK: 50_map 六步链 hideWhenFlag 标注 %d 处（%s）' % (len(hit), ' '.join(hit)))
else:
    print('OK（已落，跳过）: 50_map')

# ---------- 断言 ----------
v50 = read(P50)
seen = {}
for rid, r in (v50.get('rooms') or {}).items():
    for a in (r.get('actions') or []):
        cmd = a.get('cmd')
        if cmd in HIDE_MAP:
            seen[cmd] = (rid, a)
missing = [c for c in HIDE_MAP if c not in seen]
assert not missing, '六步链动作缺失: %s' % missing
for cmd, (rid, a) in seen.items():
    assert a.get('hideWhenFlag') == HIDE_MAP[cmd], '%s hideWhenFlag 不对' % cmd
    # 自洽：hideWhenFlag 必须由该动作自己置——直接 effects 的 flag，或菜单选项
    # raw 里的 flag:xxx（回茶摊/动身这类分支动作是菜单置旗，grep 动作整块 JSON）
    blob = json.dumps(a, ensure_ascii=False)
    assert ('"flag"' in blob and HIDE_MAP[cmd] in blob) or ('flag:' + HIDE_MAP[cmd]) in blob, \
        '%s 的 hideWhenFlag %s 不在自身置旗/菜单里' % (cmd, HIDE_MAP[cmd])
print('断言全过：%d 个动作 hideWhenFlag 逐个对上自身完成旗标（零新增 flag）' % len(seen))
