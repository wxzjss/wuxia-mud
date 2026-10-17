#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j3b_caseAB.py —— 批5·卷三第二批 分段1/2（design/97 §九.4 #5，游有方 2026-10-18）
----------------------------------------------------------------
报①：西域/星宿侧两案 S3 改造（1-stage 池壳 → 4-stage，照批4 67 款：原收束
stage 原样后移 + 卷界锁 know_zhenyi）+ 四处指路房动作。
  案 A 星宿侧·阮听「妹妹那碗药」 hk_npcv_090_meimei（require jieyao 保留）
  案 B 西域侧·陈语冰「枕下那个字」 hk_npcv_252_zi（require minge 保留）
红线：s0/新 stage 零 rewards（不并主线）；原菜单逐字不动；无破折号；
     无旁白对偶；无朱雀偏好词；keywords 全库不撞（含「问解药/问抄纸/拍卖」）。
幂等：结构比对，两连跑 OK。写盘：61/50_map 均 indent=2+尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P61 = os.path.join(ROOT, 'game', 'data', '61_sidequests.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

d61, d50 = read(P61), read(P50)
dirty61 = dirty50 = False

LOCK_J3 = {"flag": "know_zhenyi", "name": "卷三·伪秘籍",
           "msg": "伪秘籍的事没到收束那一步。这一层，等北边的信有了下落再谈。"}

def go(stage_id, room, hint):
    return {"id": stage_id, "kind": "room", "key": room, "count": 1,
            "var": stage_id, "desc": hint}

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def flag(f): return {"type": "flag", "args": [f]}

def expand1(q, new_stages):
    """1-stage 池壳 → 4-stage：新写 3 stage + 原收束 stage 原样后移加锁。"""
    assert len(q['stages']) == 1, q['id'] + ' 结构不是 1-stage'
    s0 = q['stages'][0]
    s0['next'] = 99
    s0['lock'] = dict(LOCK_J3)
    q['stages'] = new_stages + [s0]

# =====================================================================
# 案 A · 星宿侧·阮听「妹妹那碗药」
# =====================================================================
QA = d61['quests']['hk_npcv_090_meimei']
if len(QA.get('stages') or []) == 1:
    expand1(QA, [
      {  # s0 接案：妹妹的药钱（阮听房）
        "desc": "回东市·果子摊，听阮听说妹妹的药钱",
        "targets": [go("hk_npcv_090_meimei_goA", "jn_fruit_stall", "听阮听说妹妹的药钱")],
        "next": 1,
        "effects": [
          narr("阮听把秤杆收进箱子，动作比往常慢了一倍。"),
          say("「药钱我凑得出来，凑不出的是药引那头。姑苏燕子坞有位毛郎中，收得住星宿海的毒。我这副身子过不去。你的腿还利索。」")
        ]
      },
      {  # s1 燕子坞问诊（毛清辨）
        "desc": "去姑苏·燕子坞，找郎中毛清辨验那碗药的毒",
        "targets": [go("hk_npcv_090_meimei_goB", "gusu_yanzi", "找毛郎中验毒")],
        "next": 2,
        "effects": [
          narr("毛清辨搭了脉，只搭了左腕，眉头就没松开过。"),
          narr("「这不是病。是蛊，星宿海的蛊。药压得住疼，压不住根。方子在那边一间药庐里，上回有人去问过。」"),
          flag("meimi_poison_known")
        ]
      },
      {  # s2 药庐翻试方册
        "desc": "去星宿海·药庐，翻那本试方的册子",
        "targets": [go("hk_npcv_090_meimei_goC", "xiyu_herb_hut", "翻药庐的试方册")],
        "next": 3,
        "effects": [
          narr("药庐窗下的架子码着一摞册子，最上面那本封皮不上字，只按着一个指印。"),
          narr("翻开，一笔一笔记着试过什么、熬了几日、反应如何。字迹越往后越稳。末页只有一行：哥若来，别让我回去。"),
          flag("meimi_note_read")
        ]
      }
    ])
    dirty61 = True

# =====================================================================
# 案 B · 西域侧·陈语冰「枕下那个字」
# =====================================================================
QB = d61['quests']['hk_npcv_252_zi']
if len(QB.get('stages') or []) == 1:
    expand1(QB, [
      {  # s0 接案：枕下的纸（雅阁）
        "desc": "回醉春楼·雅阁，听陈语冰说枕下那张纸",
        "targets": [go("hk_npcv_252_zi_goA", "jn_brothel_room", "听陈语冰说那张纸")],
        "next": 1,
        "effects": [
          narr("抄本的事了了，雅阁的灯又添回三盏。陈语冰坐在原处，一只手压着枕沿，没挪开。"),
          say("「枕底下有张纸。梅拾说烧了干净，我压着它三年。你识字，替我瞧瞧上头到底写了什么。」")
        ]
      },
      {  # s1 看枕下（雅阁）
        "desc": "在房里，看枕下那张纸写的是什么",
        "targets": [go("hk_npcv_252_zi_goB", "jn_brothel_room", "看枕下那张纸")],
        "next": 2,
        "effects": [
          narr("枕头底下那张纸折了四折，折缝磨得发白。摊开，墨迹洇了大半，只剩个字的轮廓还认得出。"),
          narr("那个字是「陈」。她的姓。牙婆的船上没有名字，货单上只记斤两，这是她自己挣回来的头一个字。"),
          flag("zi_name_known")
        ]
      },
      {  # s2 疏勒旧货单
        "desc": "去疏勒·巴扎，翻常家货栈的旧货单",
        "targets": [go("hk_npcv_252_zi_goC", "xiyu_bazaar", "翻常家货栈的旧账")],
        "next": 3,
        "effects": [
          narr("常家货栈的旧账压在柜底，三年前那册的封皮脱了线。"),
          narr("翻到南边那几页：收进来的「货」没有名姓，一概按斤两记账，行话叫「走件」。当年经手的一笔，画着与雪谷运单同一款记号。"),
          flag("zi_ledger_seen")
        ]
      }
    ])
    dirty61 = True

# ---- 终稿校准：案B s1 叙述去重（已落盘回改路径，幂等） ----
# 朱雀整案 ppl 红的根因：s1 新写与原壳 s3 复用「上面只有一个字，笔画歪歪扭扭，
# 是…写的」同一串 → 玩家连读两遍同句。原壳逐字不许动，改 s1。
OLD_S1 = "枕头底下那张纸折了四折，折缝磨得发白。摊开，上头只有一个字，笔画歪歪扭扭，是初学的人写的。"
NEW_S1 = "枕头底下那张纸折了四折，折缝磨得发白。摊开，墨迹洇了大半，只剩个字的轮廓还认得出。"
for _st in (QB.get('stages') or [])[1:2]:
    for _ef in _st.get('effects') or []:
        if _ef.get('type') == 'narrate' and _ef.get('raw') == OLD_S1:
            _ef['raw'] = NEW_S1
            dirty61 = True

# =====================================================================
# 指路房动作（批4 同款：cond=quest 进行中；append 不动原条目）
# ---------------------------------------------------------------------
# ⚠️ 一条踩过的坑（批5 实测，写死在这里防复发）：
#   挂房文件必须挂「**最后定义该房**」的那份：引擎按文件序深合并，
#   rooms.<id>.actions 数组**后载胜**（utils.deepMerge 口径）。
#   jn_brothel_room 在 65_mainline_act3.json 里另有定义（问抄纸），
#   挂 50_map 的被整条顶掉 → 引擎里动作不存在，输入落到内置 look
#   （回「这里没有「枕」」），玩家点按钮等于点了个死键。⇒ 必须挂 65。
#   （附：曾疑「cmd 以内置主词开头会被吞」——已实测推翻：看当铺告帖 /
#     看行情帖 / 看经架 / 看车辙 均能命中房动作。runRoomAction 整串匹配
#     先于内置 CMD。本条不是词的问题，是房的问题。）
#   另：cmd 仍用「掀枕下」而非「看枕下」，只因「掀」比「看」更贴动作本身；
#     不是回避内置词。
# =====================================================================
P65 = os.path.join(ROOT, 'game', 'data', '65_mainline_act3.json')
d65 = read(P65)
dirty65 = False

HOOKS = [   # 挂 50_map 的三处（引擎实测该三房无后位文件覆盖）
  ("gusu_yanzi", "问诊", "找毛郎中验毒", ["问诊", "毛郎中"],
   ["毛清辨的药庐临水，门槛上的木纹被病人的手摸得发亮。",
    "他搭了脉，只搭了左腕：「这不是病。是蛊，星宿海的蛊。方子在星宿海那间药庐里，上回有人去问过。」"],
   "hk_npcv_090_meimei", "meimi_poison_known"),
  ("xiyu_herb_hut", "翻试方册", "翻药庐的试方册", ["试方册", "翻方册"],
   ["窗下的架子码着一摞册子，最上面那本封皮不上字，只按着一个指印。",
    "翻开，一笔一笔记着试过什么、熬了几日。末页只有一行：哥若来，别让我回去。"],
   "hk_npcv_090_meimei", "meimi_note_read"),
  ("xiyu_bazaar", "翻旧货单", "翻常家货栈的旧货单", ["旧货单", "货单"],
   ["常家货栈的旧账压在柜底，三年前那册的封皮脱了线。",
    "收进来的「货」没有名姓，一概按斤两记账。当年经手的一笔，画着与雪谷运单同一款记号。"],
   "hk_npcv_252_zi", "zi_ledger_seen"),
]
for rid, cmd, label, kws, narrs, qid, flg in HOOKS:
    room = d50['rooms'][rid]
    acts = room.setdefault('actions', [])
    if not any(a.get('cmd') == cmd for a in acts):
        acts.append({
            "cmd": cmd, "label": label, "keywords": kws,
            "desc": label,
            "cond": {"quest": qid},
            "effects": [narr(t) for t in narrs] + [flag(flg)]
        })
        dirty50 = True

# 挂 65 的一处（jn_brothel_room 在 65 有定义，见坑①）
HOOK65 = ("jn_brothel_room", "掀枕下", "掀枕下那张纸", ["枕下", "那张纸"],
          ["枕头底下那张纸折了四折，折缝磨得发白。",
           "摊开，墨迹洇了大半，只剩个字的轮廓还认得出。那个字是「陈」。"],
          "hk_npcv_252_zi", "zi_name_known")
rid, cmd, label, kws, narrs, qid, flg = HOOK65
room65 = d65['rooms'][rid]
acts65 = room65.setdefault('actions', [])
_eff = [narr(t) for t in narrs] + [flag(flg)]
_hit65 = [a for a in acts65 if a.get('cmd') == cmd]
if not _hit65:
    acts65.append({
        "cmd": cmd, "label": label, "keywords": kws,
        "desc": label,
        "cond": {"quest": qid},
        "effects": _eff
    })
    dirty65 = True
elif json.dumps(_hit65[0].get('effects'), ensure_ascii=False) != json.dumps(_eff, ensure_ascii=False):
    _hit65[0]['effects'] = _eff      # 终稿校准（幂等：文本不同才覆盖）
    dirty65 = True

# 清掉上一轮误挂 50_map 的 jn_brothel_room 坏条目（看枕下 / 掀枕下）
r50b = d50['rooms'].get('jn_brothel_room')
if r50b and r50b.get('actions'):
    keep = [a for a in r50b['actions'] if a.get('cmd') not in ('看枕下', '掀枕下')]
    if len(keep) != len(r50b['actions']):
        r50b['actions'] = keep
        dirty50 = True

# =====================================================================
# 接案动作 cond 补前置（缺口修复）
# ---------------------------------------------------------------------
# 引擎口径：require.questDone 只在「可接列表」（availableQuestOf，
# commands.js availableQuestOf → evalCond(qd0.require)）生效；
# NPC 动作接案路径只看动作自身 cond —— 两案接案动作原 cond 只有
# {"not":{quest}}，前置链（jieyao / minge）会被绕过。
# 修法：cond 补 and[not quest, questDone 前置]，与 quest.require 同源。
# =====================================================================
ACCEPT_FIX = {
  'npcv_090': ('问妹妹',  'hk_npcv_090_meimei', 'hk_npcv_090_jieyao'),
  'npcv_252': ('问那本书', 'hk_npcv_252_zi',     'hk_npcv_252_minge'),
}
for nid, (cmd, qid, pre) in ACCEPT_FIX.items():
    for a in d61['npcs'][nid]['actions']:
        if a.get('cmd') == cmd:
            want = {"and": [{"not": {"quest": qid}}, {"questDone": pre}]}
            if json.dumps(a.get('cond'), ensure_ascii=False, sort_keys=True) != \
               json.dumps(want, ensure_ascii=False, sort_keys=True):
                a['cond'] = want
                dirty61 = True

# ---------------- 落盘 ----------------
if dirty61:
    write(P61, d61); print('OK: 61_sidequests（案A/案B 4-stage S3 改造 + 卷界锁）')
else:
    print('OK（已落，跳过）: 61_sidequests')
if dirty50:
    write(P50, d50); print('OK: 50_map（三处指路房动作 + 清坏条目）')
else:
    print('OK（已落，跳过）: 50_map')
if dirty65:
    write(P65, d65); print('OK: 65_mainline_act3（掀枕下 指路房动作）')
else:
    print('OK（已落，跳过）: 65_mainline_act3')

# ---------------- 断言（重读盘面） ----------------
v61, v50, v65 = read(P61), read(P50), read(P65)
SHELLS = {  # 原收束 stage 逐字快照（say/narrate/menu）
 'hk_npcv_090_meimei': {
   'say': '「我给她下过一味不会死的毒。就为了丁春秋信我还有用，肯续我的解药。」',
   'narrate': '他摊开手掌，掌心里一道旧疤，是常年攥着药包磨出来的。',
   'menu': '妹妹那碗药|替他妹妹解蛊并告知真相>+karma:15;+pot:70;+exp:280;favor:npcv_090:-30;incvar:favor_npcv_090:-30;flag:hk_npcv_090_meimei_tell;;瞒下>+karma:-5;+exp:140;favor:npcv_090:20;incvar:favor_npcv_090:20',
   'target': 'gusu_yanzi'},
 'hk_npcv_252_zi': {
   'narrate': '她从枕下抽出一张纸，上面只有一个字，笔画歪歪扭扭，是梅拾教她写的头一个。',
   'say': '「恨得越狠，这张纸越舍不得烧。」',
   'menu': '枕下那个字|让梅拾知晓>+karma:5;+exp:220;favor:npcv_219:30;incvar:favor_npcv_219:30;favor:npcv_252:-20;incvar:favor_npcv_252:-20;flag:hk_npcv_252_zi_tell;;什么都不说>+exp:100;favor:npcv_252:10;incvar:favor_npcv_252:10',
   'target': 'jn_brothel_room'},
}
MAIN_FLAGS = ('know_zhenyi', 'snow_lead', 'act1_', 'act2_', 'act3_')
for qid, snap in SHELLS.items():
    q = v61['quests'][qid]
    assert len(q['stages']) == 4, qid + ' stage 数不是 4'
    last = q['stages'][-1]
    raws = [e.get('raw') for e in last['effects']]
    assert snap['say'] in raws, qid + ' 原收束 say 被动'
    assert snap['narrate'] in raws, qid + ' 原收束 narrate 被动'
    assert snap['menu'] in raws, qid + ' 原收束菜单被动'
    assert last['next'] == 99 and last['lock']['flag'] == 'know_zhenyi', qid + ' 卷界锁/next 不对'
    tkeys = [t['key'] for t in last.get('targets') or []]
    assert snap['target'] in tkeys, qid + ' 原收束 target 被动'
    # 原壳 require 保留
    if qid == 'hk_npcv_090_meimei':
        assert q['require'] == {"questDone": "hk_npcv_090_jieyao"}, qid + ' require 被动'
    else:
        assert q['require'] == {"questDone": "hk_npcv_252_minge"}, qid + ' require 被动'
    # 新 stage 零 rewards、无破折号、无偏好词
    new_blob = json.dumps(q['stages'][:-1], ensure_ascii=False)
    assert 'rewards' not in new_blob, qid + ' 新 stage 带了 rewards'
    assert '——' not in new_blob, qid + ' 破折号混入'
    for w in ('落地', '死死', '猛地', '稳稳', '最后'):
        assert w not in new_blob, qid + ' 偏好词混入: ' + w
    for st in q['stages']:
        for t in st.get('targets') or []:
            assert t['key'] in v50['rooms'], qid + ' target 房悬空: ' + t['key']

# 指路动作断言
for rid, cmd, label, kws, narrs, qid, flg in HOOKS:
    acts = v50['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路动作没落'
    assert any(e.get('type') == 'flag' and e['args'] == [flg] for e in hit[0]['effects']), rid + ' 指路 flag 缺'
# 65 上的指路动作（jn_brothel_room）
_h = [a for a in v65['rooms']['jn_brothel_room']['actions'] if a.get('cmd') == HOOK65[1]]
assert len(_h) == 1 and _h[0]['cond'] == {"quest": HOOK65[5]}, '65 jn_brothel_room 指路动作没落'
assert any(e.get('type') == 'flag' and e['args'] == [HOOK65[6]] for e in _h[0]['effects']), '65 指路 flag 缺'
# 65 原条目没被挤掉（问抄纸）
assert any(a.get('cmd') == '问抄纸' for a in v65['rooms']['jn_brothel_room']['actions']), '65 问抄纸 被挤掉'
# 50_map 里不许再残留挂错的 jn_brothel_room 指路条目
assert not any(a.get('cmd') in ('看枕下', '掀枕下') for a in (v50['rooms'].get('jn_brothel_room', {}).get('actions') or [])), \
    '50_map 残留 jn_brothel_room 坏条目（会被 65 覆盖且白占位）'
# 接案动作 cond 带前置
for nid, (cmd, qid, pre) in ACCEPT_FIX.items():
    a = next(x for x in v61['npcs'][nid]['actions'] if x.get('cmd') == cmd)
    assert a['cond'] == {"and": [{"not": {"quest": qid}}, {"questDone": pre}]}, nid + ' 接案 cond 缺前置'
# 原条目未被挤掉
assert any(a.get('cmd') == '探索' for a in v50['rooms']['gusu_yanzi']['actions'])
assert any(a.get('cmd') == 'list 果子摊' for a in v50['rooms']['jn_fruit_stall']['actions'])
# keywords 全库不撞：只查本轮新增的指路词（cmd+keywords）
#  ① 不碰 FORBID（全局指令主词与高频既有主词）
#  ② 不与全库任何既有动作词撞（排除自身四条）
FORBID = {'问解药', '解药', '问箱子', '问阮听', '问抄纸', '抄纸', '拍卖', '拍卖行'}
NEW_WORDS = set()
for h in HOOKS:
    NEW_WORDS |= {h[1]} | set(h[3])
NEW_WORDS |= {HOOK65[1]} | set(HOOK65[3])
clash = NEW_WORDS & FORBID
assert not clash, f"新指路动作撞全局/既有主词: {clash}"
for rid, room in v50['rooms'].items():
    for a in (room.get('actions') or []):
        if any(rid == h[0] and a.get('cmd') == h[1] for h in HOOKS):
            continue
        w2 = {a.get('cmd', '')} | set(a.get('keywords') or [])
        c = NEW_WORDS & {x for x in w2 if x}
        assert not c, f"{rid} 新指路词撞既有动作词: {c}"
# 65 既有动作（含 问抄纸 等）也不得撞新词
for rid, room in v65['rooms'].items():
    for a in (room.get('actions') or []):
        if rid == HOOK65[0] and a.get('cmd') == HOOK65[1]:
            continue
        w2 = {a.get('cmd', '')} | set(a.get('keywords') or [])
        c = NEW_WORDS & {x for x in w2 if x}
        assert not c, f"65:{rid} 新指路词撞既有动作词: {c}"
print('断言全过：两案 4-stage / 原收束逐字 / 卷界锁 / require 保留 / 指路 4 处（65 挂房） / 无撞词 / 65 原条目未挤掉')
