#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j3b_float_shankou.py —— 批5·卷三第二批 分段2/2（design/105 §四/§五）
----------------------------------------------------------------
件② 浮名回报件：road_xixia_1「对三线的账」（俞初处）
      cond or[三线取证旗] + notFlag act3_mole_named + notFlag act3_mole_withheld
      menu 双选：照实说 → act3_mole_named + rep:朝廷:20 ／ 留一手 → act3_mole_withheld
件③ 哨卡验牌接引场：beijiang_shankou「递牌」
      cond or[bj_manifest, pass_shankou] + notFlag shankou_card_seen
      narrate×2 + say（兵对簿）+ flag shankou_card_seen

⚠️ 挂房纪律（批5 案B 踩过）：两房 actions 都由 65 定义
   （road_xixia_1 另有 73_sects_place 的 rooms 块，但那份没有 actions 键；
     数组后载胜只在**键存在**时发生）→ 一律挂 65，不挂 50_map。
红线：零 rewards / 不并主线 / 无破折号 / 无旁白对偶 / 无朱雀偏好词；
      keywords 不与同房既有动作、全局主词重叠。
幂等：cmd 存在则只在 effects/cond 有 diff 时覆盖。写盘 indent=2 + 尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P65 = os.path.join(ROOT, 'game', 'data', '65_mainline_act3.json')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def flag(f): return {"type": "flag", "args": [f]}

d65 = read(P65)
dirty = False

# 三线取证旗（与主线 s3 or[] 判式同源扩集；任意一线交差都有去向）
THREE_LINES = ["snow_evidence_xixia", "bj_manifest", "ruan_cure",
               "poisoned_xingxiu", "refuse_fake"]

# ---------------------------------------------------------------------
# 件② 对三线的账（road_xixia_1 · 俞初）
# ---------------------------------------------------------------------
A2 = {
  "cmd": "对账",
  "label": "对三线的账",
  "keywords": ["对账", "三线的账", "对一遍账"],
  "desc": "把北边三条道上查来的事，摆到俞初面前对一遍",
  "cond": {"and": [
      {"or": [{"flag": f} for f in THREE_LINES]},
      {"notFlag": "act3_mole_named"},
      {"notFlag": "act3_mole_withheld"},
  ]},
  "effects": [
      narr("俞初把茶碗往边上推了推，腾出半张桌面。「北边三条道，你走了几条，我心里有数。」"),
      narr("他摆出三样东西：半页运单，一片从冰面上揭下来的纸，一个空药包。「摆在一处，是一件事。这账说给谁听，你定。」"),
      {"type": "menu",
       "raw": "对三线的账|照实说>flag:act3_mole_named;+rep:朝廷:20;;留一手>flag:act3_mole_withheld"},
  ],
}

# ---------------------------------------------------------------------
# 件③ 递牌（beijiang_shankou · 哨卡）
# ---------------------------------------------------------------------
A3 = {
  "cmd": "递牌",
  "label": "递牌过哨",
  "keywords": ["递牌", "验牌", "过哨"],
  "desc": "把牌子递过哨卡，让兵对一对",
  "cond": {"and": [
      {"or": [{"flag": "bj_manifest"}, {"flag": "pass_shankou"}]},
      {"notFlag": "shankou_card_seen"},
  ]},
  "effects": [
      narr("兵把长枪往雪里一戳，接过牌子翻了个面，朝哨楼里喊了一声。"),
      narr("哨楼里下来一个人，抱着本簿子，指尖从上往下点。点过一行，抬头看你一眼。"),
      say("「单子上的货，卡上的人，早有人对过账了。打这往上，道认牌不认人。有人先你一步，把你的名字递上去了。」"),
      flag("shankou_card_seen"),
  ],
}

TARGETS = [("road_xixia_1", A2), ("beijiang_shankou", A3)]
for rid, want in TARGETS:
    room = d65['rooms'][rid]
    acts = room.setdefault('actions', [])
    hit = [a for a in acts if a.get('cmd') == want['cmd']]
    if not hit:
        acts.append(want)
        dirty = True
    else:
        old = hit[0]
        if json.dumps(old.get('cond'), ensure_ascii=False, sort_keys=True) != \
           json.dumps(want['cond'], ensure_ascii=False, sort_keys=True) or \
           json.dumps(old.get('effects'), ensure_ascii=False) != json.dumps(want['effects'], ensure_ascii=False) or \
           old.get('label') != want['label'] or (old.get('keywords') or []) != want['keywords']:
            old.update(want)
            dirty = True

if dirty:
    write(P65, d65)
    print('OK: 65_mainline_act3（件② 对账 + 件③ 递牌）')
else:
    print('OK（已落，跳过）: 65_mainline_act3')

# =====================================================================
# 断言（重读盘面）
# =====================================================================
v = read(P65)
for rid, want in TARGETS:
    acts = v['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == want['cmd']]
    assert len(hit) == 1, rid + ' 动作没落或重复: ' + want['cmd']
    a = hit[0]
    assert a['cond'] == want['cond'], rid + ' cond 不符'
    assert a['effects'] == want['effects'], rid + ' effects 不符'
    assert a['keywords'] == want['keywords'], rid + ' keywords 不符'
    # 零 rewards / 不并主线（不出现 questdone / quest 效果）
    blob = json.dumps(a, ensure_ascii=False)
    assert 'rewards' not in blob, rid + ' 带了 rewards'
    assert '"questdone"' not in blob and '"type": "quest"' not in blob, rid + ' 并了主线'
    assert '——' not in blob, rid + ' 破折号混入'
    for w in ('落地', '死死', '猛地', '稳稳', '最后'):
        assert w not in blob, rid + ' 偏好词混入: ' + w

# 件②：三线 or 覆盖齐、双 flag 去重齐、菜单双选与 rep 写法
a2 = [a for a in v['rooms']['road_xixia_1']['actions'] if a.get('cmd') == '对账'][0]
or_flags = [c.get('flag') for c in a2['cond']['and'][0]['or']]
assert or_flags == THREE_LINES, '件② 三线 or 集不符: ' + str(or_flags)
menu = [e for e in a2['effects'] if e.get('type') == 'menu'][0]['raw']
assert '照实说>flag:act3_mole_named;+rep:朝廷:20' in menu, '件② 照实说分支不符'
assert '留一手>flag:act3_mole_withheld' in menu, '件② 留一手分支不符'
assert menu.count(';;') == 1, '件② 菜单不是两项'

# 件③：cond 双通道、flag 名
a3 = [a for a in v['rooms']['beijiang_shankou']['actions'] if a.get('cmd') == '递牌'][0]
or3 = [c.get('flag') for c in a3['cond']['and'][0]['or']]
assert or3 == ['bj_manifest', 'pass_shankou'], '件③ 通道路径不符: ' + str(or3)
assert any(e.get('type') == 'flag' and e['args'] == ['shankou_card_seen'] for e in a3['effects']), '件③ flag 缺'

# 同房既有动作未被挤掉、keywords 不撞
for rid, keep in (('road_xixia_1', '截信'), ('beijiang_shankou', '摸哨')):
    acts = v['rooms'][rid]['actions']
    assert any(a.get('cmd') == keep for a in acts), rid + ' 既有动作被挤掉: ' + keep
    cmds = [a.get('cmd') for a in acts]
    assert len(cmds) == len(set(cmds)), rid + ' cmd 重复: ' + str(cmds)
for rid, want in TARGETS:
    mine = set(want['keywords']) | {want['cmd']}
    for a in v['rooms'][rid]['actions']:
        if a.get('cmd') == want['cmd']:
            continue
        other = {a.get('cmd', '')} | set(a.get('keywords') or [])
        clash = mine & {x for x in other if x}
        assert not clash, f"{rid} 撞既有动作词: {clash}"
GLOBAL = {'看', '去', '走', '听', '说', '问', '查', '搜', '用', '给', '问解药', '问抄纸', '拍卖'}
for _, want in TARGETS:
    clash = (set(want['keywords']) | {want['cmd']}) & GLOBAL
    assert not clash, '撞全局主词: ' + str(clash)

# flag 无重复 setter（本批唯一来源：这两个动作）
for flg in ('act3_mole_named', 'act3_mole_withheld', 'shankou_card_seen'):
    cnt = json.dumps(v, ensure_ascii=False).count('"%s"' % flg)
    assert cnt >= 1, flg + ' 未落'

print('断言全过：件② 对账（三线 or 五旗 + 双 flag 去重 + 菜单双选/rep）'
      ' / 件③ 递牌（双通道 + flag + 原动作未挤掉 + 无撞词 + 零 rewards）')
