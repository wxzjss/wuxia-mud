#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j5b_batch1.py —— 批7·卷五第一批（design/107，游有方 2026-10-18）
----------------------------------------------------------------
件① 夏承志两案 2-stage（时限压接案点，收束不加锁）
       hk_npcv_082_mibao（require notFlag know_depot_master）
       hk_npcv_082_hua  （require questDone mibao）
       + 接案动作 cond 补前置（第三次同类缺口：原 cond 只有 not quest）
       + palace_study 指路「看那幅画」
件② 结局回响 2 场
       palace_hall「殿上余响」：交卷 / 半交
       palace_road「出宫余响」：拒交 / 远航（预留，实现未落）

⚠️ 挂房纪律（批5/6 两次验证）：palace_study / palace_prison 的 actions 只在
   50_map；palace_hall / palace_road 的最后定义分片是 66（50_map 与 66 都带
   actions 键，66 后载胜）→ 分别挂对。
⚠️ 吞词纪律（批6 踩过）：palace_road 既有「过御道」keywords 含『御道』，
   回响 cmd 若含御道会被它先命中 → 回响两场**排 actions 头部**，且 cmd 不含
   既有动作的 keyword 子串。
红线：零 rewards / 不并主线 / 无破折号 / 无对偶 / 无偏好词 / keywords 不撞。
幂等：结构比对，两连跑 OK。写盘 indent=2 + 尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P61 = os.path.join(ROOT, 'game', 'data', '61_sidequests.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')
P66 = os.path.join(ROOT, 'game', 'data', '66_mainline_act45.json')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def flag(f): return {"type": "flag", "args": [f]}
def go_var(sid, room, hint):
    return {"id": sid, "kind": "room", "key": room, "count": 1, "var": sid, "desc": hint}

d61, d50, d66 = read(P61), read(P50), read(P66)
dirty61 = dirty50 = dirty66 = False

# =====================================================================
# 件① 案A · 埋在院里那份副本（2-stage）
# =====================================================================
QA_ID = 'hk_npcv_082_mibao'
QA = d61['quests'][QA_ID]
if len(QA.get('stages') or []) == 1:
    shell = QA['stages'][0]
    shell['next'] = 99            # 口径①：收束不加锁
    shell.pop('lock', None)
    QA['stages'] = [
      {
        "desc": "在天牢廊下，听夏承志说院里埋的那份副本",
        "targets": [go_var("hk_npcv_082_mibao_goA", "palace_prison", "听夏承志说那份副本")],
        "next": 1,
        "effects": [
          narr("天牢的过道里有铁链拖地的声音，隔一会儿响一阵。夏承志坐在廊下那张旧凳上，手搭在膝头。"),
          say("「我每递一回，就埋一份。院角那层土，我留着等你来刨。刨出来，拿去衙门大堂见元怀瑾。他认得我的字。」")
        ]
      },
      shell,
    ]
    dirty61 = True

# =====================================================================
# 件① 案B · 书房里那幅画（2-stage）
# =====================================================================
QB_ID = 'hk_npcv_082_hua'
QB = d61['quests'][QB_ID]
if len(QB.get('stages') or []) == 1:
    shellB = QB['stages'][0]
    shellB['next'] = 99
    shellB.pop('lock', None)
    QB['stages'] = [
      {
        "desc": "在天牢廊下，听夏承志提御书房那幅画",
        "targets": [go_var("hk_npcv_082_hua_goB", "palace_prison", "听夏承志提那幅画")],
        "next": 1,
        "effects": [
          narr("他还坐在那张旧凳上。牢门半开，廊下有风，吹得灯芯一晃。"),
          say("「老爷书房那幅画，我理了三十年，一次没敢多看。你去御书房替我看一眼。画上那片水，是不是我记的那片。」")
        ]
      },
      shellB,
    ]
    dirty61 = True

# 接案动作 cond 补前置（时限 / 链条）
ACCEPT = {
  '问旧仆':   {"and": [{"not": {"quest": QA_ID}}, {"not": {"flag": "know_depot_master"}}]},
  '问那幅画': {"and": [{"not": {"quest": QB_ID}}, {"questDone": QA_ID}]},
}
for a in d61['npcs']['npcv_082']['actions']:
    want = ACCEPT.get(a.get('cmd'))
    if want and json.dumps(a.get('cond'), ensure_ascii=False, sort_keys=True) != \
              json.dumps(want, ensure_ascii=False, sort_keys=True):
        a['cond'] = want
        dirty61 = True

# =====================================================================
# 指路：palace_study「看那幅画」（挂 50_map）
# =====================================================================
HOOK = {
  # ⚠️ 批7 实测：cmd 以「看」开头的整串会被内置 look 截走（'看那幅画' → 当名词看），
  #    而 keywords 里的『那幅画』『画上那片水』都能正常命中房动作。
  #    既有条目「看封墙」之所以活着是历史遗留，新动作一律不用「看」开头。
  "cmd": "端详那幅画", "label": "看御书房那幅画",
  "keywords": ["那幅画", "画上那片水", "书房画"],
  "desc": "端详御书房墙上那幅画",
  "cond": {"quest": QB_ID},
  "effects": [
      narr("画挂在御案侧面的墙上，绢色旧了，边角有一处补过的痕。"),
      narr("画上是一片水，水里许多小圈，一圈套着一圈。和绣阁那面绣架上的，是同一幅底稿。"),
  ],
}
acts50 = d50['rooms']['palace_study'].setdefault('actions', [])
# 清理上一轮误用的「看那幅画」（会被内置 look 截走，且与终稿共 keywords）
_keep = [a for a in acts50 if a.get('cmd') != '看那幅画']
if len(_keep) != len(acts50):
    d50['rooms']['palace_study']['actions'] = acts50 = _keep
    dirty50 = True
h = [a for a in acts50 if a.get('cmd') == HOOK['cmd']]
if not h:
    acts50.append(HOOK); dirty50 = True
elif json.dumps(h[0], ensure_ascii=False, sort_keys=True) != json.dumps(HOOK, ensure_ascii=False, sort_keys=True):
    h[0].clear(); h[0].update(HOOK); dirty50 = True

# =====================================================================
# 件② 结局回响 2 场（挂 66，排头部）
# =====================================================================
ECHO_HALL = {
  "cmd": "殿上余响", "label": "殿上余响",
  "keywords": ["余响", "殿上", "再站一会儿"],
  "desc": "在殿上再站一会儿",
  "cond": {"and": [{"or": [{"flag": "ending_jiaojuan"}, {"flag": "ending_banjiao"}]},
                   {"notFlag": "echo_hall_seen"}]},
  "effects": [
      {"type": "cond", "if": {"flag": "ending_jiaojuan"},
       "then": [
         narr("殿门在你身后合上。案上那本册子还摊着，末页那个名字的墨色没干透。"),
         narr("往后街上念你的名字，念的是书里那一行。你站在那行字外头听着，没有应。"),
       ],
       "else": [
         narr("你出殿的时候，冯保还站在案边。册子摊在最后一页，笔尖上的墨凝成一颗，没有落下去。"),
         narr("他没有喊你。往后江湖上提起那一年的事，说的都是别人。"),
       ]},
      flag("echo_hall_seen"),
  ],
}

ECHO_ROAD = {
  "cmd": "出宫余响", "label": "出宫余响",
  "keywords": ["余响", "出宫", "路上"],
  "desc": "从宫里往外走，回头想一想",
  "cond": {"and": [{"or": [{"flag": "ending_jujiao"}, {"flag": "ending_yuanhang"}]},
                   {"notFlag": "echo_road_seen"}]},
  "effects": [
      {"type": "cond", "if": {"flag": "ending_jujiao"},
       "then": [
         narr("出宫的路上没有别人。城门上贴着你的画像，风把边角吹起来，又按回去。"),
         narr("有人在你门口放过酒，也有人朝你吐过唾沫。两样你都收下了，一样也没有还回去。"),
       ],
       "else": [
         narr("出宫的路走到底，就是码头。船离岸的时候，岸上的人都还站在原地。"),
         narr("海上的雾把皇城收进去，收得很干净。你把那卷东西留在了长凳底下，没有带走。"),
       ]},
      flag("echo_road_seen"),
  ],
}

def upsert_head(room, want):
    global dirty66
    acts = room.setdefault('actions', [])
    hit = [a for a in acts if a.get('cmd') == want['cmd']]
    if not hit:
        acts.insert(0, want); dirty66 = True
    elif json.dumps(hit[0], ensure_ascii=False, sort_keys=True) != json.dumps(want, ensure_ascii=False, sort_keys=True):
        hit[0].clear(); hit[0].update(want); dirty66 = True

upsert_head(d66['rooms']['palace_hall'], ECHO_HALL)
upsert_head(d66['rooms']['palace_road'], ECHO_ROAD)

# =====================================================================
# 件②补 · 远航结局落点（haitan_boat「上船离港」，lead 2026-10-18 裁定）
# ---------------------------------------------------------------------
# ⚠️ 不许落「cond 恒假」的死动作：nv_huang_trust / xiakedao_invited 全库无
#    setter（悬空旗，与 act1_done 幽灵旗同族）→ 收窄到现网真旗：
#      three_words       卷五 stage3「清音洞听黄药师三句话」真落（66 有 setter）
#      haitan_ferry_seen  批6 接引场（问过船期）——逼玩家先问船，接引场才有用
#      notFlag act5_done  面圣已了结就不再放人走
#    待卷五主线补 nv_huang_trust / xiakedao_invited 后，把 or 放宽（记 backlog）。
# 排在 actions 头部：「渡海」keywords 含单字『船』会吞含船输入（批6 坑）。
# =====================================================================
SAIL = {
  "cmd": "上船离港", "label": "上船离港",
  "keywords": ["上船", "离港", "开船"],
  "desc": "不问去处，先上船",
  "cond": {"and": [{"flag": "three_words"}, {"flag": "haitan_ferry_seen"},
                   {"notFlag": "act5_done"}, {"notFlag": "act5_sail"}]},
  "effects": [
      narr("你把船钱放在船板上。艄公看了一眼，没数，收进袖里。"),
      narr("缆绳解开的时候，岸上的人都还站在原地，没有人招手。"),
      narr("船离了港，海上的雾从两边合上来，把皇城收进去，收得很干净。"),
      {"type": "ending", "args": ["yuanhang", "远航"]},
      flag("act5_sail"),
  ],
}
upsert_head(d66['rooms']['haitan_boat'], SAIL)

# ---------------- 落盘 ----------------
for path, dirty, name in ((P61, dirty61, '61_sidequests（两案 2-stage + 接案前置）'),
                          (P50, dirty50, '50_map（palace_study 指路）'),
                          (P66, dirty66, '66_mainline_act45（结局回响 2 场）')):
    if dirty:
        write(path, {'61_sidequests.json': d61, '50_map.json': d50, '66_mainline_act45.json': d66}[os.path.basename(path)])
        print('OK: ' + name)
    else:
        print('OK（已落，跳过）: ' + name.split('（')[0])

# =====================================================================
# 断言（重读盘面）
# =====================================================================
v61, v50, v66 = read(P61), read(P50), read(P66)
SHELLS = {
 QA_ID: {'target': 'jn_yamen_court',
         'narrate': '他领你到院角，蹲下来刨开一层土，露出一角油纸包。',
         'say': '「我每递一回，就埋一份。不是留证据，是留后路。」',
         'menu': '院里那份副本|替他收好>+exp:260;+pot:70;favor:npcv_082:40;incvar:favor_npcv_082:40;flag:hk_npcv_082_mibao_keep;;交给东厂>+rep:朝廷:20;+exp:200;favor:npcv_149:-50;incvar:favor_npcv_149:-50;flag:hk_npcv_082_mibao_give'},
 QB_ID: {'target': 'palace_prison',
         'narrate': '他说到「写进去」三个字，手在袖子里攥了一下。',
         'say': '「老爷书房那幅画，我理了三十年，一次没敢多看。可那幅画上记的事，是我写进去的。」',
         'menu': '书房里那幅画|助元怀瑾自清>+karma:15;+exp:280;+pot:70;favor:npcv_149:40;incvar:favor_npcv_149:40;flag:hk_npcv_082_hua_clear;;不问>+exp:100;favor:npcv_082:10;incvar:favor_npcv_082:10'},
}
for qid, snap in SHELLS.items():
    q = v61['quests'][qid]
    assert len(q['stages']) == 2, qid + ' stage 数不是 2'
    last = q['stages'][-1]
    raws = [e.get('raw') for e in last['effects']]
    for k in ('narrate', 'say', 'menu'):
        assert snap[k] in raws, qid + ' 原壳 %s 被动' % k
    assert last['next'] == 99, qid + ' next 不对'
    assert 'lock' not in last, qid + ' 收束不该加锁（时限案口径①）'
    assert snap['target'] in [t['key'] for t in last.get('targets') or []], qid + ' 原壳 target 被动'
    nb = json.dumps(q['stages'][:-1], ensure_ascii=False)
    assert 'rewards' not in nb, qid + ' 新 stage 带 rewards'
    assert '——' not in nb, qid + ' 破折号混入'
    for w in ('落地', '死死', '猛地', '稳稳', '最后'):
        assert w not in nb, qid + ' 偏好词混入: ' + w

# 接案 cond
amap = {a.get('cmd'): a.get('cond') for a in v61['npcs']['npcv_082']['actions']}
assert amap['问旧仆'] == {"and": [{"not": {"quest": QA_ID}}, {"not": {"flag": "know_depot_master"}}]}, '问旧仆 cond 不对'
assert amap['问那幅画'] == {"and": [{"not": {"quest": QB_ID}}, {"questDone": QA_ID}]}, '问那幅画 cond 不对'

# 指路
hh = [a for a in v50['rooms']['palace_study']['actions'] if a.get('cmd') == HOOK['cmd']]
assert len(hh) == 1 and hh[0]['cond'] == {"quest": QB_ID}, 'palace_study 指路没落'
assert any(a.get('cmd') == '看封墙' for a in v50['rooms']['palace_study']['actions']), 'palace_study 原动作被挤掉'

# 回响 2 场
for rid, want, other_key in (('palace_hall', ECHO_HALL, 'ending_banjiao'),
                             ('palace_road', ECHO_ROAD, 'ending_yuanhang')):
    acts = v66['rooms'][rid]['actions']
    assert acts[0].get('cmd') == want['cmd'], rid + ' 回响没排到头部'
    a = acts[0]
    assert a['cond'] == want['cond'], rid + ' 回响 cond 不符'
    blob = json.dumps(a, ensure_ascii=False)
    assert 'rewards' not in blob and '"questdone"' not in blob, rid + ' 回响并了主线'
    assert '——' not in blob, rid + ' 破折号混入'
    assert 'ending_' in blob, rid + ' 回响没读结局旗'
# 既有两个结局旗名与 60 成就口径一致（ending_jiaojuan/jujiao/banjiao）
s60 = io.open(os.path.join(ROOT, 'game', 'data', '60_quests.json'), encoding='utf-8-sig').read()
for f in ('ending_jiaojuan', 'ending_jujiao', 'ending_banjiao'):
    assert f in s60, '60 成就口径缺 ' + f

# 撞词 / 吞词
GLOBAL = {'看', '去', '走', '听', '说', '问', '查', '搜', '用', '给', '拿', '打'}
NEW = [('palace_study', HOOK), ('palace_hall', ECHO_HALL), ('palace_road', ECHO_ROAD)]
for rid, want in NEW:
    words = {want['cmd']} | set(want['keywords'])
    assert not (words & GLOBAL), rid + ' 撞全局主词: ' + str(words & GLOBAL)
    acts = v66['rooms'][rid]['actions'] if rid in v66['rooms'] else v50['rooms'][rid]['actions']
    idx = {a.get('cmd'): i for i, a in enumerate(acts)}
    my = idx[want['cmd']]
    for a in acts:
        if a.get('cmd') == want['cmd']:
            continue
        other = {a.get('cmd', '')} | set(a.get('keywords') or [])
        assert not (words & {x for x in other if x}), rid + ' ' + want['cmd'] + ' 撞词: ' + str(words & other)
        if idx[a.get('cmd')] > my:
            continue
        for k in (a.get('keywords') or []):
            if k and k != want['cmd'] and k in want['cmd']:
                raise AssertionError(f"{rid} 既有「{a.get('cmd')}」的 keyword「{k}」会吞新 cmd「{want['cmd']}」")

# 远航落点（haitan_boat）
acts_h = v66['rooms']['haitan_boat']['actions']
assert acts_h[0].get('cmd') == '上船离港', '上船离港 没排到头部'
sa = acts_h[0]
assert sa['cond'] == {"and": [{"flag": "three_words"}, {"flag": "haitan_ferry_seen"},
                              {"notFlag": "act5_done"}, {"notFlag": "act5_sail"}]}, '远航 cond 不符'
assert any(e.get('type') == 'ending' and e['args'][0] == 'yuanhang' for e in sa['effects']), '远航 ending 缺'
blob_sa = json.dumps(sa, ensure_ascii=False)
assert 'nv_huang_trust' not in blob_sa and 'xiakedao_invited' not in blob_sa, '远航 cond 含悬空旗（恒假入口）'
assert 'rewards' not in blob_sa, '远航带 rewards'
# 问船期 仍排在其后但可用（顺序不吞）
cmd_list = [a.get('cmd') for a in acts_h]
assert cmd_list.index('上船离港') < cmd_list.index('问船期') < cmd_list.index('渡海'), '海路三动作顺序不对'
# 三旗都有 setter（不是悬空）
s66 = io.open(P66, encoding='utf-8-sig').read()
for f in ('three_words', 'haitan_ferry_seen'):
    assert f in s66, '远航前置旗无 setter: ' + f

print('断言全过：两案 2-stage / 原壳逐字 / 收束无锁 / 接案前置（时限+链条） / 指路 1 / '
      '回响 2 场（四结局覆盖） / 远航落点（三旗可活，无悬空旗） / 排头不吞词 / 零 rewards')
