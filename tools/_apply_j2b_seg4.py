#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j2b_seg4.py —— 批4·卷二第二批 分段4/4（design/97 §九.4 #4，游有方 2026-10-16）
----------------------------------------------------------------
段4 六案（67 池后 6，改造法同段3：s0 verbatim、插 2 新 stage、原收束后移+铜牌锁）：
  任停(破庙是谁的)/元怀瑾(库房多出的三千两)/强秋(箱子里的货)/
  黄清(三年前那一船人)/药婆婆(山上的那个后生)/梅拾(胭脂盒夹层里的账)
幂等：内容比对，两连跑 OK。写盘：67/50_map 均 indent=2+尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')

P67 = os.path.join(ROOT, 'game', 'data', '67_sidequests2.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

d67, d50 = read(P67), read(P50)
dirty67 = dirty50 = False

LOCK_A2 = {"flag": "pre_a2_menfang", "name": "卷二·铜牌来路",
           "msg": "铜牌的来路还没到签押房。这一层，等门房的事了了再谈。"}

def go(stage_id, room, hint):
    return {"id": stage_id, "kind": "room", "key": room, "count": 1,
            "var": stage_id, "desc": hint}

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def menu(t): return {"type": "menu", "raw": t}

def expand(q, new_stages):
    """67 案 2-stage → 4-stage：s0 verbatim、插 2 stage、原收束后移+铜牌锁"""
    assert len(q['stages']) == 2, q['id'] + ' 结构不是 2-stage'
    s1 = q['stages'][1]
    s1['next'] = 99
    s1['lock'] = dict(LOCK_A2)
    q['require'] = {"flag": "jiuye_done"}
    q['stages'] = [q['stages'][0]] + new_stages + [s1]

# =====================================================================
# 案 19 · 任停「破庙是谁的」
# =====================================================================
Q = d67['quests']['hk_npcv_027_miaozheng']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 七年的香火（丐帮破庙）
        "desc": "去丐帮·破庙，问和苍这七年的香火是谁在拜",
        "targets": [go("hk_npcv_027_miaozheng_goA", "gaibang_po_miao", "去破庙问香火")],
        "next": 2,
        "effects": [
          narr("和苍把功德簿翻到七年前：「任停进庙那天起，香火没断过。每月初一，他给每一尊像都上一炷。」"),
          say("「庙是谁的，贫道说不清。香是谁上的，簿子上记着。」"),
          menu("功德簿这一页|借来对一对年份，明日归还>+exp:150;flag:j2b_miao_xiang;;出三十文添香油，自己翻>-money:30;+pot:40;flag:j2b_miao_xiang")
        ]
      },
      {  # s2 递牌子的手续（架阁库）
        "desc": "去衙门·架阁库，问递牌子调旧契的手续",
        "targets": [go("hk_npcv_027_miaozheng_goB", "jn_yamen_arch", "去架阁库问递牌")],
        "next": 3,
        "effects": [
          narr("看库的老吏把牌子推过来：「木箱最底下那叠，两百多年的旧契。牌子递了，一次只能调一契，隔日取。」"),
          say("「旧契出库要画押。画押的人，名字就在契的后头跟着走。」"),
          menu("递牌子|替任停把牌子递了，画押写自己的名字>-money:30;+rep:朝廷:8;+exp:150;flag:j2b_miao_pai;;等老吏值夜，托他通融>+exp:130;+pot:40;flag:j2b_miao_pai")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 案 20 · 元怀瑾「库房多出的三千两」
# =====================================================================
Q = d67['quests']['hk_npcv_149_hegong']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 钦差出京那天（后衙）
        "desc": "去衙门·后衙，对钦差出京那天的过所记录",
        "targets": [go("hk_npcv_149_hegong_goA", "jn_yamen_back", "去后衙对日子")],
        "next": 2,
        "effects": [
          narr("黄清把过所底簿翻出来：「钦差出京那天，过银子的车打了三趟来回。每趟的火牌号，我都记着。」"),
          say("「记着没用。递上去，火牌就换成了别的日子。这案难就难在，日子会自己改。」"),
          menu("火牌的号|抄一份，藏在别处>+rep:朝廷:10;+exp:150;flag:j2b_he_pai;;只对日子，不抄不记>+exp:130;+pot:50;flag:j2b_he_pai")
        ]
      },
      {  # s2 银子的戳记（库房）
        "desc": "去衙门·库房，看多出的银子熔铸的戳记",
        "targets": [go("hk_npcv_149_hegong_goB", "jn_yamen_store", "去库房看戳记")],
        "next": 3,
        "effects": [
          narr("多出的那几箱银子，锭底的戳记与河工银不同批：河工银是本府官炉，多出的戳着京里的炉号。"),
          say("管库的老吏压低声音：「京炉的银子走到县库，中间该过三道手。这三道手，一道都没留下名字。」"),
          menu("炉号的样式|描下来，往后对得上>+exp:160;flag:j2b_he_lu;;不碰库银，只记箱数>+pot:50;+exp:140;flag:j2b_he_lu")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 案 21 · 强秋「箱子里的货」
# =====================================================================
Q = d67['quests']['hk_npcv_081_xiangzi']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 刁立要钱的日子（栈桥）
        "desc": "去码头·栈桥，等刁立每月来要钱的日子",
        "targets": [go("hk_npcv_081_xiangzi_goA", "jn_harbor_wharf", "去栈桥蹲守")],
        "next": 2,
        "effects": [
          narr("栈桥上等到日头偏西。刁立果然来了，收钱的匣子没锁。他数完钱往回走，嘴里哼着小曲，脚步没有一点防备。"),
          say("船家认得这个人：「唐门的采买，一月来一回。回回走水路，回回赶涨潮。」"),
          menu("刁立的脚程|记下他走的路线，往后用得上>+exp:150;flag:j2b_xiao_diao;;花钱买船家一句实话>-money:30;+exp:130;flag:j2b_xiao_diao")
        ]
      },
      {  # s2 文书的印（东巷）
        "desc": "去东市·东巷，对镖行文书上那枚药行的印记",
        "targets": [go("hk_npcv_081_xiangzi_goB", "jn_market_east", "去东巷对印")],
        "next": 3,
        "effects": [
          narr("东巷药行的柜上挂着自家的印样。镖行文书上那枚印，边角的花纹对不上：真印五瓣，文书上是四瓣。"),
          say("药行的伙计看了一眼就收回去：「四瓣的印，是十年前作废的旧版。这文书是假的。」"),
          menu("印记的花纹|描一份假印的样子，留作凭据>+rep:朝廷:8;+exp:150;flag:j2b_xiao_yin;;不惊动药行，只记铺名>+exp:140;+pot:40;flag:j2b_xiao_yin")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 案 22 · 黄清「三年前那一船人」
# =====================================================================
Q = d67['quests']['hk_npcv_181_guanliang']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 开船的渡口（江口码头）
        "desc": "去江口码头，找当年开船的老船家",
        "targets": [go("hk_npcv_181_guanliang_goA", "jn_harbor", "去码头找老船家")],
        "next": 2,
        "effects": [
          narr("老船家的船泊在最外侧。「三年前那晚的水，是决了口的浑水。船是官家的快船，开船的是个女公差，一脸的水。」"),
          say("「她一个人撑篙，船上的哭声压过了水声。我这辈子忘不了那趟船。」"),
          menu("那晚的水路|听他把船开到哪儿讲完>+exp:160;flag:j2b_chuan_lu;;留五十文酒钱，不用他多说>-money:50;+karma:8;+exp:140;flag:j2b_chuan_lu")
        ]
      },
      {  # s2 丐帮的名册（破庙）
        "desc": "去丐帮·破庙，对和苍收留的人里还有几个当年上船的",
        "targets": [go("hk_npcv_181_guanliang_goB", "gaibang_po_miao", "去破庙对名册")],
        "next": 3,
        "effects": [
          narr("和苍的名册记在布条上。当年那船人，如今在册的还有七个，走了的没记名字。"),
          say("「活着的人不肯提那一晚。不是忘了，是不敢。贫道也不问。」"),
          menu("布条名册|只对人数，不动名册>+exp:150;flag:j2b_chuan_ce;;留五十文给庙里，替那些人添口粥>-money:50;+karma:8;+exp:140;flag:j2b_chuan_ce")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 案 23 · 药婆婆「山上的那个后生」
# =====================================================================
Q = d67['quests']['hk_yaopopo_shanzi']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 唐门的人过山（华山客舍）
        "desc": "去华山·客舍，问过路客商有没有见过唐门的人",
        "targets": [go("hk_yaopopo_shanzi_goA", "huashan_qingke", "去客舍打听")],
        "next": 2,
        "effects": [
          narr("客舍的伙计压低声音：「上个月有三拨人上山，穿的像药农，手上没茧。药农的手，哪有不沾泥的。」"),
          say("「他们在后山转了两天，下山时鞋底沾的是红土。后山哪来的红土，那是药园的土。」"),
          menu("红土的事|记下那三拨人下山的日子>+exp:150;flag:j2b_yao_ke;;给伙计买壶酒，再问细些>-money:40;+exp:130;flag:j2b_yao_ke")
        ]
      },
      {  # s2 半卷解毒方（药婆婆的家）
        "desc": "去药婆婆的家，翻她收着的那些医书",
        "targets": [go("hk_yaopopo_shanzi_goB", "hm_wen_huashan_shop", "去药婆婆家找方子")],
        "next": 3,
        "effects": [
          narr("药婆婆家的医书堆了半墙。她自己从墙缝里抽出半卷手抄的方子，纸都脆了：「拿去。缺的后半页，我心里有。」"),
          say("「这半卷是我师父抄的。抄它那年，唐门还认这条道上的人。」"),
          menu("半卷方子|抄下来，剩下的靠药婆婆自己补>+exp:160;flag:j2b_yao_fang;;不抄原卷，记下缺的那几味药>+exp:140;+pot:50;flag:j2b_yao_fang")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 案 24 · 梅拾「胭脂盒夹层里的账」
# =====================================================================
Q = d67['quests']['hk_npcv_219_zhangmu']
if len(Q.get('stages') or []) == 2:
    expand(Q, [
      {  # s1 她爹那笔账（翰墨斋后堂）
        "desc": "去翰墨斋·后堂，请鲁拂衣对那本账的笔迹",
        "targets": [go("hk_npcv_219_zhangmu_goA", "jn_study_1", "去后堂对笔迹")],
        "next": 2,
        "effects": [
          narr("鲁拂衣对完笔迹：「账是她爹抄的，一笔不差。错的那行不在她爹手上，在上头发下来的底册里。」"),
          say("「底册改一个字，抄的人掉脑袋。这样的账，历年不止一笔。」"),
          menu("底册的说法|记下这句话，往后对证用得上>+exp:150;flag:j2b_zhang_bi;;请她把底册的来历写清楚>+rep:朝廷:8;+exp:140;flag:j2b_zhang_bi")
        ]
      },
      {  # s2 经手人的名字（刑房）
        "desc": "去衙门·刑房，翻她爹那桩案子的经手人",
        "targets": [go("hk_npcv_219_zhangmu_goB", "jn_yamen_wt", "去刑房翻旧案")],
        "next": 3,
        "effects": [
          narr("刑房的旧档里，那桩案子办得飞快：三月问，四月斩。经手人的名字被虫蛀掉一半，剩下半个「钱」字。"),
          say("当值书吏把这册收得比别的快：「老案了，别翻。翻它的人，后来都没能升上去。」"),
          menu("半个「钱」字|记下，往后对上人就齐了>+exp:160;flag:j2b_zhang_qian;;不多翻，把册子原样放回>+exp:140;+pot:50;flag:j2b_zhang_qian")
        ]
      },
    ])
    dirty67 = True

# =====================================================================
# 指路：6 个 room action 钩子
# =====================================================================
HINTS = [
  ("jn_yamen_store", "翻庙契的木箱", "翻库房里压庙契的木箱", ["翻木箱", "庙契"],
   "库房最底下那口木箱的锁眼发亮，常开常关。箱里的旧契按年份码着，最旧那叠在最底下。",
   "hk_npcv_027_miaozheng"),
  ("jn_yamen_back", "对钦差出京的日子", "翻后衙的过所底簿对日子", ["对日子", "过所底簿"],
   "过所底簿里钦差出京那天的记录被折了角。折角的位置，正好是三趟银车那一段。",
   "hk_npcv_149_hegong"),
  ("jn_harbor_wharf", "等刁立来要钱", "在栈桥等唐门采买来收钱", ["等刁立", "栈桥"],
   "栈桥的木桩上有一道旧勒痕，一月磨出一道。最近那道，还是新的。",
   "hk_npcv_081_xiangzi"),
  ("jn_harbor", "问开船的老船家", "向码头的老船家打听旧年水路", ["问船家", "老船家"],
   "码头最外侧泊着条旧船。船家说不载客，可船舱里的草席换得比谁的都勤。",
   "hk_npcv_181_guanliang"),
  ("huashan_qingke", "问过路的客商", "向客舍的过路客商打听山上的事", ["问客商", "过路客商"],
   "客舍的伙计说，近来上山的外乡人多起来，都说是采药的，手上却一个茧子也没有。",
   "hk_yaopopo_shanzi"),
  ("jn_yamen_wt", "翻虫蛀的旧案", "翻刑房里虫蛀的旧案卷", ["翻旧案", "虫蛀"],
   "刑房的旧档架最里层有几册被虫蛀了。办得快的案子，卷册反而保存得最整齐。",
   "hk_npcv_219_zhangmu"),
]
for rid, cmd, label, kws, text, qid in HINTS:
    room = d50['rooms'][rid]
    acts = room.setdefault('actions', [])
    if not any(a.get('cmd') == cmd for a in acts):
        acts.append({
            "cmd": cmd, "label": label, "keywords": kws,
            "desc": label,
            "cond": {"quest": qid},
            "effects": [{"type": "narrate", "raw": text}]
        })
        dirty50 = True

# ---------------- 落盘 ----------------
if dirty67:
    write(P67, d67); print('OK: 67_sidequests2（段4 六案改造）')
else:
    print('OK（已落，跳过）: 67_sidequests2')
if dirty50:
    write(P50, d50); print('OK: 50_map（段4 六案指路 room action）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------------- 断言 ----------------
v67, v50 = read(P67), read(P50)
S0 = {
 'hk_npcv_027_miaozheng': ['库房最底下那口木箱里，压着一叠旧契。', 'hk_npcv_027_ren'],
 'hk_npcv_149_hegong': ['管库的老吏说，送银子来的人没留名。', 'hk_npcv_149_hegong_silent'],
 'hk_npcv_081_xiangzi': ['「钉子是新加的，加了三道。」', 'hk_npcv_081_xiangzi_kai'],
 'hk_npcv_181_guanliang': ['有个老的听见黄清的名字，把手里的叫花鸡放下了。', 'hk_npcv_181_guanliang_seal'],
 'hk_yaopopo_shanzi': ['篮底垫着几片嫩叶，是解一半毒的药。', 'hk_yaopopo_shanzi_ming'],
 'hk_npcv_219_zhangmu': ['夹层里那叠纸比胭脂还薄。', 'hk_npcv_219_zhangmu_send'],
}
for qid, (need_raw, need_flag) in S0.items():
    q = v67['quests'][qid]; tag = q['name']
    assert len(q['stages']) == 4, tag + ' stage 数应为 4'
    raws = [e.get('raw') or '' for e in q['stages'][0]['effects'] if e.get('type') in ('narrate', 'say')]
    assert any(need_raw in r for r in raws), tag + ' s0 原文被动'
    last = q['stages'][-1]
    ml = [e for e in last.get('effects', []) if e.get('type') == 'menu']
    assert ml and 'flag:' + need_flag in ml[0]['raw'], tag + ' 原收束菜单被动'
    assert last.get('lock', {}).get('flag') == 'pre_a2_menfang', tag + ' 铜牌锁没落'
    assert q['require'] == {"flag": "jiuye_done"}, tag + ' require 被动'
    blob = json.dumps(q['stages'][1:3], ensure_ascii=False)
    assert '——' not in blob, tag + ' 破折号混入'
    for s in q['stages']:
        for t in s.get('targets', []):
            assert t['key'] in v50['rooms'], tag + ' 目标房悬空: ' + t['key']
for rid, cmd, qid in [(h[0], h[1], h[5]) for h in HINTS]:
    acts = v50['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路动作没落'
# 段1-3 指路未被挤掉
for rid, cmd in (('jn_market_west', '翻米行流水'), ('jn_teahouse', '问楼里旧事'), ('jn_yamen_arch', '翻过所底簿')):
    assert any(a.get('cmd') == cmd for a in v50['rooms'][rid]['actions']), '段1 指路被动'
for rid, cmd in (('jn_yamen_store', '翻缺页的旧档'), ('jiangnan_temple', '读庙外老碑')):
    assert any(a.get('cmd') == cmd for a in v50['rooms'][rid]['actions']), '段3 指路被动'
print('断言全过：段4 六案 / s0 verbatim / 原收束后移+铜牌锁 / require / target 全存在 / 指路 6 处 / 段1-3 指路未被动 / 无破折号')
