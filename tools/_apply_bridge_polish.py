#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_bridge_polish.py —— 主人真机反馈三件（2026-10-15，游有方）
----------------------------------------------------------------
① 过桥段删四动作（主人钦定）：dumuqiao 的 抢过/背东西过/硬闯/跳下去 整体删除，
   失败链只留 探桥→稳脚→过桥 主链；四段的演出随动作一并收。
   连带收掉孤儿消费方「看伤」（63 活声明 + 50_map 死拷贝两处；50_map 那份在
   合并层本就被 63 的 actions 数组整组覆盖——deepMerge 数组默认 replace），
   act1_knee_hurt / act1_knee_seen 两 flag 随链退役（全库零残留断言钉死）。
② 出生点山贼根治：上轮 104 的 noWander 钉死**从未生效**——world.js:1250
   `npc.wander = def.wander ? clone(...) : defaultWanderFor(...)` 与
   ambience.js:213 `if (def.wander) return def.wander;`（判序在 noWander 之前）
   双短路：40_npcs 自带的 wander:{chance:0.08} 永远赢。实测复现：encounter
   刷出的山贼实例 wander=0.08，2000 tick 漂到 xy_home_03（跨区乱漂）。
   引擎判序修正归寇豆码（两处）；数据侧根治：104 分片 mob_bandit 补
   "wander": null（deepMerge 对 null 是覆盖语义），40_npcs 不动
   （indent=1 无尾换行的 byte-identity 口径文件，不碰）。
③ 独木桥门槛收紧（101 单一路径哲学）：未接信（act1_letter_taken）前
   dumuqiao.n 出口挂 introHidden——茶摊→看信→回来过桥是正路；
   藏按钮不锁路，与出生点四出口藏灯体系同款（引擎不消费，前端寇豆码）。
幂等：内容比对，两连跑 OK。写盘口径：三文件均 indent=2 + 尾换行（与现盘一致）。
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
P63 = os.path.join(ROOT, 'game', 'data', '63_mainline_act1.json')
P104 = os.path.join(ROOT, 'game', 'data', '104_birth_polish.json')

DEAD_CMDS = ('抢过', '背东西过', '硬闯', '跳下去')
MAIN_CMDS = ('探桥', '稳脚', '过桥')

d50, d63, d104 = read(P50), read(P63), read(P104)
dirty50 = dirty63 = dirty104 = False

# ---------- ① dumuqiao 删四动作 ----------
dq = d50['rooms']['dumuqiao']
acts = dq.get('actions') or []
keep = [a for a in acts if a.get('cmd') not in DEAD_CMDS]
if len(keep) != len(acts):
    dq['actions'] = keep
    dirty50 = True

# ---------- ① 连带：看伤（knee 链孤儿）两处收掉 ----------
inn50 = d50['rooms'].get('shanjiao_inn', {})
acts50 = inn50.get('actions') or []
keep50 = [a for a in acts50 if a.get('cmd') != '看伤']
if len(keep50) != len(acts50):
    if keep50:
        inn50['actions'] = keep50
    else:
        inn50.pop('actions', None)   # 清空则整键摘除（合并层本就被 63 覆盖）
    dirty50 = True
inn63 = (d63.setdefault('rooms', {}).setdefault('shanjiao_inn', {}))
acts63 = inn63.get('actions') or []
keep63 = [a for a in acts63 if a.get('cmd') != '看伤']
if len(keep63) != len(acts63):
    inn63['actions'] = keep63
    dirty63 = True

# ---------- ③ dumuqiao.n 出口 introHidden ----------
ex_n = dq.get('exits', {}).get('n')
assert isinstance(ex_n, dict) and ex_n.get('to') == 'shanjiao_inn', 'dumuqiao.n 结构变了，人工核'
if ex_n.get('introHidden') != 'act1_letter_taken':
    ex_n['introHidden'] = 'act1_letter_taken'
    dirty50 = True

# ---------- ② 104 mob_bandit wander:null（noWander 这回真的生效） ----------
mb = d104.setdefault('npcs', {}).setdefault('mob_bandit', {})
assert mb.get('id') == 'mob_bandit'
if 'wander' not in mb or mb.get('wander') is not None:
    mb['wander'] = None
    dirty104 = True

if dirty50:
    write(P50, d50); print('OK: 50_map（①dumuqiao 四动作删+主链留守 / ①看伤死拷贝收 / ③桥 n 出口 introHidden）')
else:
    print('OK（已落，跳过）: 50_map')
if dirty63:
    write(P63, d63); print('OK: 63_mainline_act1（①看伤活声明收）')
else:
    print('OK（已落，跳过）: 63_mainline_act1')
if dirty104:
    write(P104, d104); print('OK: 104_birth_polish（②mob_bandit wander:null——noWander 这回真生效）')
else:
    print('OK（已落，跳过）: 104_birth_polish')

# ---------- 断言 ----------
v50, v63, v104 = read(P50), read(P63), read(P104)
dq2 = v50['rooms']['dumuqiao']
cmds = tuple(a.get('cmd') for a in (dq2.get('actions') or []))
assert cmds == MAIN_CMDS, 'dumuqiao 动作链不对: %s' % (cmds,)
assert not any(c in json.dumps(dq2, ensure_ascii=False) for c in DEAD_CMDS), 'dumuqiao 四动作残留'
assert all(a.get('cond', {}).get('notFlag') != 'act1_knee_hurt' for a in dq2['actions'])
# knee 两 flag 全库（数据分片）零残留；「看伤」按动作结构判（子串会撞
# jn_pharmacy 的「请郎中看看伤」这类正常文本，不能裸 grep）
for blob, tag, j in ((json.dumps(v50, ensure_ascii=False), '50_map', v50),
                     (json.dumps(v63, ensure_ascii=False), '63', v63)):
    assert 'act1_knee_hurt' not in blob, tag + ' act1_knee_hurt 残留'
    assert 'act1_knee_seen' not in blob, tag + ' act1_knee_seen 残留'
    for rid, r in (j.get('rooms') or {}).items():
        for a in (r.get('actions') or []):
            assert a.get('cmd') != '看伤', tag + ' ' + rid + ' 看伤动作残留'
# ③ 出口字段逐项钉死
n2 = v50['rooms']['dumuqiao']['exits']['n']
assert n2['introHidden'] == 'act1_letter_taken', '③ introHidden 没落'
assert n2['cond'] == {'flag': 'act1_bridge_crossed'}, '③ cond 被动了'
assert 'say' in n2 and 'travel' in n2 and 'msg' in n2, '③ 三件套被动了'
# ② 104 补丁钉死
mb2 = v104['npcs']['mob_bandit']
assert mb2.get('noWander') is True and 'wander' in mb2 and mb2['wander'] is None, '② 104 wander:null 没落'
print('断言全过：主链三动作 / 四动作+看伤+knee 两 flag 零残留 / 桥 n introHidden+三件套原样 / 104 山贼钉死')
