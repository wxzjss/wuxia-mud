#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_same_name_fix.py —— 同地块禁同名·数据落盘（2026-10-15，游有方）
----------------------------------------------------------------
主人裁定（长期铁律）：同地块禁止同名 NPC——respawn 再也不许同房同名。
引擎实测（newGame→movePlayerTo→look→60 tick→npcsIn 按名计数，13 嫌疑房）
定案真违规 4 处（名人 def.room+respawn 双声明系引擎去重的假阳性，不动）：

① jm_underground（东市·地下黑市）：mob_bandit count=2 → count=1
   + mob_bandit_chief count=1（黑市看场子 = 头目 + 手下，剧情尺度已定；
   chief tier=mob 非名人、def.room=null，respawn 是其唯一落点，无去重副作用）。
   desc 同步：「两个抱刀的汉子蹲在门口」→ 头目（身材魁梧/拄刀而立）
   + 手下（抱刀蹲坐）两人口径，与 40_npcs 两人 desc 呼应。
② huashan_shanxia：guard_huashan count 2→1（def.name=华山弟子）。
③ palace_gate：guard_palace count 2→1（def.room=palace_gate+respawn 双声明，
   引擎实测不双计，count=1 即全场一只「禁军」）。
④ palace_plaza：guard_palace count 2→1。

幂等：内容比对，两连跑 OK。写盘口径：50_map indent=2 + 尾换行。
断言：①四处结构钉死；②全库（game/data/*.json 全分片 npcs 合并）
   respawn 条目非名人 count==1；③同房非名人显示名唯一（名人豁免，
   isCelebrity = unique===true || tier==='A'，对齐 world.js:34）；
   ④本批触碰文本无破折号。
"""
import json, os, io, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

JM_RESPAWN_OLD = [{"npc": "mob_bandit", "count": 2, "chance": 1}]
JM_RESPAWN_NEW = [
    {"npc": "mob_bandit", "count": 1, "chance": 1},
    {"npc": "mob_bandit_chief", "count": 1, "chance": 1},
]
DESC_OLD = "两个抱刀的汉子蹲在门口，见人下来才抬眼。"
DESC_NEW = "门口立着一个身材魁梧的汉子，手按在刀上，另一个抱刀的蹲在石阶边，见人下来才抬眼。"

d50 = read(P50)
dirty = False

# ① jm_underground：respawn 头目+手下 + desc 同步
jm = d50['rooms']['jm_underground']
if jm.get('respawn') == JM_RESPAWN_OLD:
    jm['respawn'] = JM_RESPAWN_NEW
    dirty = True
if DESC_OLD in (jm.get('desc') or ''):
    jm['desc'] = jm['desc'].replace(DESC_OLD, DESC_NEW)
    dirty = True

# ②③④ 三处守卫 count 2→1
for rid, nid in (('huashan_shanxia', 'guard_huashan'),
                 ('palace_gate', 'guard_palace'),
                 ('palace_plaza', 'guard_palace')):
    rs = d50['rooms'][rid].get('respawn') or []
    for x in rs:
        if x.get('npc') == nid and x.get('count') == 2:
            x['count'] = 1
            dirty = True

if dirty:
    write(P50, d50); print('OK: 50_map（①黑市头目+手下+desc / ②华山 / ③④皇宫守卫 count=1）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------- 断言 ----------
v50 = read(P50)

# ① 黑市结构
jm2 = v50['rooms']['jm_underground']
assert jm2.get('respawn') == JM_RESPAWN_NEW, '黑市 respawn 没落（头目+手下）'
d = jm2.get('desc') or ''
assert DESC_NEW in d, '黑市 desc 没同步（头目+手下口径）'
assert DESC_OLD not in d, '黑市旧句残留（两个抱刀的汉子）'

# ②③④ 守卫 count
for rid, nid in (('huashan_shanxia', 'guard_huashan'),
                 ('palace_gate', 'guard_palace'),
                 ('palace_plaza', 'guard_palace')):
    ent = [x for x in (v50['rooms'][rid].get('respawn') or []) if x.get('npc') == nid]
    assert len(ent) == 1 and ent[0].get('count') == 1, rid + ' 守卫 count 没收到 1'

# 全库断言：合并全部分片 npcs def（对齐引擎 deepMerge：后载分片**按键合并**，
# 补丁分片只覆写个别键——整 def 替换会把 40_npcs 的 name 覆没，第一版踩过）
defs = {}
for p in sorted(glob.glob(os.path.join(ROOT, 'game', 'data', '*.json'))):
    try:
        j = read(p)
    except Exception:
        continue
    if isinstance(j, dict) and isinstance(j.get('npcs'), dict):
        for k, v in j['npcs'].items():
            if isinstance(v, dict):
                defs.setdefault(k, {}).update(v)

def is_celebrity(defj):
    # 对齐 world.js:34：unique===true 或 tier==='A'
    return bool(defj and (defj.get('unique') is True or defj.get('tier') == 'A'))

rooms = v50['rooms']
# 其他分片也可能带 rooms（深合并），一并收
for p in sorted(glob.glob(os.path.join(ROOT, 'game', 'data', '*.json'))):
    if os.path.basename(p) == '50_map.json':
        continue
    try:
        j = read(p)
    except Exception:
        continue
    if isinstance(j, dict) and isinstance(j.get('rooms'), dict):
        for k, v in j['rooms'].items():
            if isinstance(v, dict):
                rooms.setdefault(k, {})
                for kk, vv in v.items():
                    rooms[k].setdefault(kk, vv)

count_bad, name_bad = [], []
for rid, r in rooms.items():
    rs = r.get('respawn')
    if not rs:
        continue
    seen = {}
    for x in ([rs] if isinstance(rs, dict) else rs):
        if not (isinstance(x, dict) and x.get('npc')):
            continue
        defj = defs.get(x['npc'])
        if defj is None:
            count_bad.append((rid, x['npc'], 'def 缺失'))
            continue
        if is_celebrity(defj):
            continue  # 名人豁免：引擎全图去重，respawn 只是「保证有戏」
        if x.get('count', 1) > 1:
            # count=0 = 不自动补员（懒生成/剧本另行安排，如 master_yue/beggar_info），
            # 不构成同名风险；铁律管的是 count>1 的同 defId 复数补员。
            count_bad.append((rid, x['npc'], 'count=%s' % x.get('count')))
        nm = defj.get('name')
        if nm in seen:
            name_bad.append((rid, nm, seen[nm], x['npc']))
        seen[nm] = x['npc']
assert not count_bad, 'respawn count≠1：' + repr(count_bad)
assert not name_bad, '同房同名：' + repr(name_bad)

# 本批触碰文本无破折号（50_map 全文件 2 处存量历史口径在案，不归本批管）
assert '——' not in d, '黑市 desc 破折号混入'
print('断言全过：黑市头目+手下+desc / 华山·皇宫守卫 count=1 / 全库 respawn 非名人 count==1 / 全库同房显示名唯一（名人豁免，isCelebrity 对齐 world.js:34）')
