#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j4b_batch1.py —— 批6·卷四第一批（design/106，游有方 2026-10-18）
----------------------------------------------------------------
件① 皮朝颜山门账：hk_npcv_164_yinzi 1-stage → 4-stage（原壳后移 + 卷四界锁 act3_done）
                      + 大殿「翻旧账」/ 山门「摸井沿」两处指路
                      + 接案动作前置补（问赌坊 act3_done；问枯井 questDone yinzi）
件② L4 腰牌过哨三场（mojiao_shanmen）：亮腰牌（正）/ 报号（邪）/ 对暗号（散·karma 轴）
件③ 卷四末海路接引场（haitan_boat）：「问船期」

⚠️ 挂房纪律（批5 血泪）：mojiao_shanmen / mojiao_hall / haitan_boat 的 actions
   都由 66_mainline_act45.json 定义（且 50_map 同房无 actions 键）→ 一律挂 66。
⚠️ 匹配序坑（本批新踩）：haitan_boat 既有「渡海」keywords 含单字『船』，
   任何含「船」的输入都会先命中渡海（cond has_canjuan 不满足就吃 failMsg）。
   ⇒ 「问船期」必须**插在 actions 头部**，排在 搜查/渡海 之前。
红线：零 rewards / 不并主线 quest / 无破折号 / 无对偶 / 无偏好词 / keywords 不撞。
幂等：结构比对，两连跑 OK。写盘 indent=2 + 尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P61 = os.path.join(ROOT, 'game', 'data', '61_sidequests.json')
P66 = os.path.join(ROOT, 'game', 'data', '66_mainline_act45.json')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def flag(f): return {"type": "flag", "args": [f]}

def go_var(sid, room, hint):
    return {"id": sid, "kind": "room", "key": room, "count": 1, "var": sid, "desc": hint}

d61, d66 = read(P61), read(P66)
dirty61 = dirty66 = False

LOCK_J4 = {"flag": "act3_done", "name": "卷四·黑木崖",
           "msg": "黑木崖上的账，是过了雪谷之后的事。"}

QID = 'hk_npcv_164_yinzi'
QA = d61['quests'][QID]
if len(QA.get('stages') or []) == 1:
    shell = QA['stages'][0]
    shell['next'] = 99
    shell['lock'] = dict(LOCK_J4)
    QA['stages'] = [
      {  # s0 接案：山门，听她说那笔银子
        "desc": "回黑木崖山门，听皮朝颜说那笔周转银子",
        "targets": [go_var("hk_npcv_164_yinzi_goA", "mojiao_shanmen", "听皮朝颜说那笔银子")],
        "next": 1,
        "effects": [
          narr("皮朝颜把手拢回袖子里，先回头看了一眼崖上。"),
          say("「账上有一笔走动过的银子，走的不是明账。崖后有口井，我这辈子的银子都在里头。」"),
          narr("她说完就闭了嘴，等你先开口。")
        ]
      },
      {  # s1 大殿旧账
        "desc": "去黑木崖大殿，翻旧账查那笔银子的成色",
        "targets": [go_var("hk_npcv_164_yinzi_goB", "mojiao_hall", "翻大殿的旧账")],
        "next": 2,
        "effects": [
          narr("旧账压在殿侧木柜里，抽出来时带起一层灰。翻到那一年，同一笔进出记了两遍。"),
          narr("一遍写「采买」，数目整；另一遍只画了个圈，圈旁边是空的。"),
          flag("yinzi_ledger")
        ]
      },
      {  # s2 崖后枯井
        "desc": "回山门崖后，看那口枯井",
        "targets": [go_var("hk_npcv_164_yinzi_goC", "mojiao_shanmen", "去崖后看那口井")],
        "next": 3,
        "effects": [
          narr("崖后的井口压着一块青石。挪开半尺，井壁上有绳子磨出的沟，沟是干的。"),
          narr("井底没有水声。她说的「一枚没动」，是这口井早就空了的意思。"),
          flag("yinzi_well")
        ]
      },
      shell,
    ]
    dirty61 = True

# 接案动作前置（入口锁 + require 同源）
ACCEPT = {
  '问赌坊': {"and": [{"flag": "act3_done"}, {"not": {"quest": QID}}]},
  '问枯井': {"and": [{"not": {"quest": "hk_npcv_164_sirenzhang"}},
                     {"questDone": QID}]},
}
for a in d61['npcs']['npcv_164']['actions']:
    want = ACCEPT.get(a.get('cmd'))
    if want and json.dumps(a.get('cond'), ensure_ascii=False, sort_keys=True) != \
              json.dumps(want, ensure_ascii=False, sort_keys=True):
        a['cond'] = want
        dirty61 = True

# ---------------------------------------------------------------------
# 指路 + L4 三场 + 海路接引（全部挂 66）
# ---------------------------------------------------------------------
HOOK_PLAIN = [
  ("mojiao_hall", "翻旧账", "翻大殿的旧账", ["旧账", "翻账", "查旧账"],
   ["旧账压在殿侧木柜里，抽出来时带起一层灰。",
    "那一年的进出记了两遍：一遍写「采买」，一遍只画个圈。"],
   QID, "yinzi_ledger"),
  ("mojiao_shanmen", "摸井沿", "摸崖后那口井的井沿", ["井沿", "井口", "井台"],
   ["崖后的井口压着一块青石。挪开半尺，井壁上有绳子磨出的沟。",
    "沟是干的。井底没有水声。"],
   QID, "yinzi_well"),
]

L4 = [
  {  # ① 正派：亮腰牌（hasSect + karma 轴）
    "cmd": "亮腰牌", "label": "亮腰牌上崖",
    "keywords": ["亮腰牌", "腰牌", "门派牌"],
    "desc": "把门派腰牌递给山门哨卫",
    "cond": {"and": [{"flag": "act3_done"}, {"hasSect": True},
                     {"karma": ">=20"}, {"notFlag": "sentinel1"}]},
    "effects": [
      narr("门里两个人看的是你的手。你把腰牌摘下来，递过去。"),
      narr("左边那人接过，翻过来看了一眼背面的字，又递给右边那个。两个人各自让开半步。"),
      say("「同道的路，我们不为难。上崖吧。」"),
      flag("sentinel1"),
    ],
  },
  {  # ② 邪派：报号（恶名/魔教声望）
    "cmd": "报号", "label": "报号过哨",
    "keywords": ["报号", "递名帖", "报名号"],
    "desc": "把名号报给山门哨卫",
    "cond": {"and": [{"flag": "act3_done"},
                     {"or": [{"karma": "<=-20"}, {"rep": "日月神教", ">=": 40}]},
                     {"notFlag": "sentinel1"}]},
    "effects": [
      narr("你没有亮牌。你只把名字说出来，说得不快。"),
      narr("那两个人对看了一眼。其中一个笑了一声，笑意没到眼睛里。"),
      say("「崖上收的就是你这种人。上去吧，大殿里别乱看。」"),
      flag("sentinel1"),
    ],
  },
  {  # ③ 散人：对暗号（karma 轴放行；不足则明说不放）
    "cmd": "对暗号", "label": "对暗号",
    "keywords": ["对暗号", "暗号", "留话"],
    "desc": "跟山门哨卫对一句暗号",
    "cond": {"and": [{"flag": "act3_done"}, {"noSect": True}, {"notFlag": "sentinel1"}]},
    "effects": [
      {"type": "cond", "if": {"karma": ">=20"},
       "then": [
         narr("哨上问你走哪条道。你说了一句不相干的话：去年冬天，有人在这山下分过半袋干粮。"),
         narr("两个人对看一眼，其中一个抬起手，朝崖上指了指。"),
         say("「有人替你留过话。上崖吧，过了大殿别开口。」"),
         flag("sentinel1"),
       ],
       "else": [
         narr("哨上问你走哪条道。你把话说了，两个人没有反应。"),
         say("「这条道不认生人。你换个走过来法。」"),
         narr("他们没有拦你，也没有让开。崖上的栈道就在那儿。"),
       ]},
    ],
  },
]

FERRY = {
  "cmd": "问船期", "label": "问船期",
  "keywords": ["问船期", "船期", "几时开船"],
  "desc": "问艄公这船什么时候走",
  "cond": {"and": [{"flag": "act4_done"}, {"notFlag": "haitan_ferry_seen"}]},
  "effects": [
    narr("艄公蹲在船头补网，头也不抬。你问他这船几时走，他先把网上的结解开一个。"),
    narr("「一个月两趟。一趟往东，岛上没有活人想你上去；一趟往南，京里来的人在码头等货。」"),
    say("「你要走哪一趟，想好了再来。船不等人，人也不必等船。」"),
    flag("haitan_ferry_seen"),
  ],
}

def upsert_action(room, want, at_head=False):
    """幂等：不存在则插（可按 at_head 插头部），存在则 diff 才覆盖。"""
    global dirty66
    acts = room.setdefault('actions', [])
    hit = [a for a in acts if a.get('cmd') == want['cmd']]
    if not hit:
        if at_head:
            acts.insert(0, want)
        else:
            acts.append(want)
        dirty66 = True
        return
    old = hit[0]
    if json.dumps(old, ensure_ascii=False, sort_keys=True) != json.dumps(want, ensure_ascii=False, sort_keys=True):
        old.clear(); old.update(want)
        dirty66 = True

for rid, cmd, label, kws, narrs, qid, flg in HOOK_PLAIN:
    upsert_action(d66['rooms'][rid], {
        "cmd": cmd, "label": label, "keywords": kws, "desc": label,
        "cond": {"quest": qid},
        "effects": [narr(t) for t in narrs] + [flag(flg)],
    })

for want in L4:
    upsert_action(d66['rooms']['mojiao_shanmen'], want)

# 海路接引：必须排在「渡海」之前（渡海 keywords 含单字『船』，会吃掉含船输入）
upsert_action(d66['rooms']['haitan_boat'], FERRY, at_head=True)

# ---------------- 落盘 ----------------
if dirty61:
    write(P61, d61); print('OK: 61_sidequests（案A 4-stage + 接案前置）')
else:
    print('OK（已落，跳过）: 61_sidequests')
if dirty66:
    write(P66, d66); print('OK: 66_mainline_act45（指路 2 + L4 三场 + 问船期）')
else:
    print('OK（已落，跳过）: 66_mainline_act45')

# =====================================================================
# 断言（重读盘面）
# =====================================================================
v61, v66 = read(P61), read(P66)
SHELL = {  # 原壳逐字快照
  'narrate': '账房翻出那本旧账，纸角上留着一圈茶渍。',
  'say': '「崖后有口井。我这辈子的银子，都在里头。一枚没动。」',
  'menu': '那笔银子|替她查账>+exp:240;+pot:70;flag:hk_sirenzhang;;回报教中>+rep:日月神教:20;+exp:180;favor:npcv_164:-30;incvar:favor_npcv_164:-30',
  'target': 'mojiao_hall',
}
q = v61['quests'][QID]
assert len(q['stages']) == 4, '案A stage 数不是 4'
last = q['stages'][-1]
raws = [e.get('raw') for e in last['effects']]
for k in ('narrate', 'say', 'menu'):
    assert SHELL[k] in raws, '原壳 %s 被动' % k
assert last['next'] == 99 and last['lock']['flag'] == 'act3_done', '卷四界锁/next 不对'
assert SHELL['target'] in [t['key'] for t in last.get('targets') or []], '原壳 target 被动'
for st in q['stages']:
    for t in st.get('targets') or []:
        assert t['key'] in v66['rooms'] or t['key'] in ('mojiao_hall', 'mojiao_shanmen'), 'target 房悬空: ' + t['key']
new_blob = json.dumps(q['stages'][:-1], ensure_ascii=False)
assert 'rewards' not in new_blob, '新 stage 带 rewards'
assert '——' not in new_blob, '破折号混入'
for w in ('落地', '死死', '猛地', '稳稳', '最后'):
    assert w not in new_blob, '偏好词混入: ' + w

# 接案 cond
amap = {a.get('cmd'): a.get('cond') for a in v61['npcs']['npcv_164']['actions']}
assert amap['问赌坊'] == {"and": [{"flag": "act3_done"}, {"not": {"quest": QID}}]}, '问赌坊 cond 不对'
assert amap['问枯井'] == {"and": [{"not": {"quest": "hk_npcv_164_sirenzhang"}},
                                  {"questDone": QID}]}, '问枯井 cond 不对'

# 案B 原壳未动（1-stage 保留）
qb = v61['quests']['hk_npcv_164_sirenzhang']
assert len(qb['stages']) == 1, '案B 被误改'
assert qb['require'] == {"questDone": QID}, '案B require 被动'

# 指路
for rid, cmd, label, kws, narrs, qid, flg in HOOK_PLAIN:
    hit = [a for a in v66['rooms'][rid]['actions'] if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路没落'
    assert any(e.get('type') == 'flag' and e['args'] == [flg] for e in hit[0]['effects']), rid + ' 指路 flag 缺'

# L4 三场
l4 = {a['cmd']: a for a in v66['rooms']['mojiao_shanmen']['actions'] if a.get('cmd') in ('亮腰牌', '报号', '对暗号')}
assert set(l4) == {'亮腰牌', '报号', '对暗号'}, 'L4 三场不全: ' + str(list(l4))
assert l4['亮腰牌']['cond'] == {"and": [{"flag": "act3_done"}, {"hasSect": True}, {"karma": ">=20"}, {"notFlag": "sentinel1"}]}
assert l4['报号']['cond'] == {"and": [{"flag": "act3_done"}, {"or": [{"karma": "<=-20"}, {"rep": "日月神教", ">=": 40}]}, {"notFlag": "sentinel1"}]}
assert l4['对暗号']['cond'] == {"and": [{"flag": "act3_done"}, {"noSect": True}, {"notFlag": "sentinel1"}]}
for c, a in l4.items():
    assert 'rewards' not in json.dumps(a, ensure_ascii=False), c + ' 带 rewards'
    assert '——' not in json.dumps(a, ensure_ascii=False), c + ' 破折号'

# 海路接引：存在、排第一、cond、flag
acts_h = v66['rooms']['haitan_boat']['actions']
_cmds_h = [a.get('cmd') for a in acts_h]
assert _cmds_h.index('问船期') < _cmds_h.index('渡海'), '问船期 必须排在渡海之前（否则被『船』keyword 吃掉）'
_ferry = next(a for a in acts_h if a.get('cmd') == '问船期')
assert _ferry['cond'] == {"and": [{"flag": "act4_done"}, {"notFlag": "haitan_ferry_seen"}]}, '问船期 cond 不对'
assert any(e.get('type') == 'flag' and e['args'] == ['haitan_ferry_seen'] for e in _ferry['effects']), '问船期 flag 缺'
# 既有动作未被挤掉
for rid, cmds in (('mojiao_shanmen', ['探后山', '闯山门']),
                  ('mojiao_hall', ['过前殿', '回大殿']),
                  ('haitan_boat', ['搜查', '渡海'])):
    have = [a.get('cmd') for a in v66['rooms'][rid]['actions']]
    for c in cmds:
        assert c in have, rid + ' 既有动作被挤掉: ' + c
    assert len(have) == len(set(have)), rid + ' cmd 重复'

# keywords 撞车（同房既有动作 + 全局主词）
GLOBAL = {'看', '去', '走', '听', '说', '问', '查', '搜', '用', '给', '拿', '打'}
NEW = {}
for rid, cmd, label, kws, narrs, qid, flg in HOOK_PLAIN:
    NEW.setdefault(rid, []).append((cmd, set(kws) | {cmd}))
for want in L4:
    NEW.setdefault('mojiao_shanmen', []).append((want['cmd'], set(want['keywords']) | {want['cmd']}))
NEW.setdefault('haitan_boat', []).append((FERRY['cmd'], set(FERRY['keywords']) | {FERRY['cmd']}))
for rid, items in NEW.items():
    acts = v66['rooms'][rid]['actions']
    idx = {a.get('cmd'): i for i, a in enumerate(acts)}
    for cmd, words in items:
        assert not (words & GLOBAL), rid + ' ' + cmd + ' 撞全局主词: ' + str(words & GLOBAL)
        my = idx.get(cmd)
        for a in acts:
            if a.get('cmd') == cmd:
                continue
            other = {a.get('cmd', '')} | set(a.get('keywords') or [])
            clash = words & {x for x in other if x}
            assert not clash, f"{rid} {cmd} 撞既有动作词: {clash}"
        # 子串吞词：既有动作的 keyword 若被新 cmd 包含，只有它排在**新动作之前**才真会吞
        for a in acts:
            if a.get('cmd') == cmd:
                continue
            if idx[a.get('cmd')] > my:
                continue      # 排在新动作之后，输入先命中的是新动作，不构成吞词
            for k in (a.get('keywords') or []):
                if k and k != cmd and k in cmd:
                    raise AssertionError(
                        f"{rid} 既有动作「{a.get('cmd')}」(idx={idx[a.get('cmd')]}) 的 keyword"
                        f"「{k}」会吞掉新 cmd「{cmd}」(idx={my})")

print('断言全过：案A 4-stage / 原壳逐字 / 卷四界锁 act3_done / 接案前置 / 指路 2 / '
      'L4 三场（正邪散） / 问船期排头 / 既有动作未挤掉 / 无撞词无吞词 / 零 rewards')
