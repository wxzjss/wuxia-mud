#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j2b_seg1.py —— 批4·卷二第二批 分段1/4（design/97 §九.4 #4，游有方 2026-10-16）
----------------------------------------------------------------
61 池中原案 S3 范式改造（口径同 design/102 卷三 4 案）：
  · s0 = 原池壳 verbatim（菜单/物品/rewards 逐字不动），next 99→1；
  · s1-s3 新写（中转房 + 双通道菜单），s4 收束（新收束菜单双选 + stage.lock）；
  · require 卷界前置：{flag:'jiuye_done'}（65 拦车戏两分支都置，散人/门派通用；
    act1_done 是幽灵旗——travel.js 消费但全库无人置，禁用）；
  · 收束 stage.lock 按卷界：61 腹地案锁 jiuye_done（卷界门）；
  · rewards 不并主线：rewards 数组 verbatim，断言无 quest/主线 flag 效果；
  · 指路 ≥1：每案中转房加 1 个 room action 钩子（cond={quest:qid} 进行中）。
段1 六案：和放(绸缎庄窟窿)/穆逢(妆匣那张纸)/屈疏(府学那道门)/
         邬修远(三年攒的那匹绸)/乐知(北边那趟镖)/熊时(那幅百子图)。
幂等：内容比对，两连跑 OK。写盘：61/50_map 均 indent=2+尾换行。
"""
import json, os, io, copy

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
orig61 = copy.deepcopy(d61)
orig50 = copy.deepcopy(d50)
dirty61 = dirty50 = False

LOCK_J2 = {"flag": "jiuye_done", "name": "卷二·风起",
           "msg": "这桩事还没到能见底的时候。东边的路没开，话就还没处说。"}

def go(stage_id, room, hint):
    return {"id": stage_id, "kind": "room", "key": room, "count": 1,
            "var": stage_id, "desc": hint}

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def menu(t): return {"type": "menu", "raw": t}

# =====================================================================
# 案 1 · 和放「绸缎庄的窟窿」
# =====================================================================
Q = d61['quests']['hk_npcv_241_yinzi']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 亏空去向（西巷米行流水）
        "desc": "去东市·西巷，翻米行的流水找同一笔进项",
        "targets": [go("hk_npcv_241_yinzi_go1", "jn_market_west", "去西巷翻米行流水")],
        "next": 2,
        "effects": [
          narr("米行的流水抄得密。翻到三年前那页，一行进项跳出来：绸缎庄赊出去的那批货，银子进的却是米行的户头。"),
          say("掌柜的把流水按住：「这行字不是写给我们看的。是写给往后查账的人看的。」"),
          menu("流水怎么翻|请行会掌柜吃茶，借全本账册>-money:80;+exp:140;+pot:30;flag:j2b_yinzi_ledger;;只抄这一页，不多看>+exp:120;+karma:5;flag:j2b_yinzi_ledger")
        ]
      },
      {  # s2 架阁库的断口
        "desc": "去衙门·架阁库，查绸缎庄东家跑路前销掉的那笔账",
        "targets": [go("hk_npcv_241_yinzi_go2", "jn_yamen_arch", "去架阁库查旧档")],
        "next": 3,
        "effects": [
          narr("架阁库的旧档按年分捆。绸缎庄那一卷抽出来，中间缺了一页，断口齐整，像照着一把尺裁的。"),
          say("看库的老吏头也不抬：「销账要盖印。那页的印，盖了两次。」"),
          menu("缺的那页|照原样抄一份底>+exp:130;flag:j2b_yinzi_page;;记在脑子里，不落纸>+pot:50;flag:j2b_yinzi_page")
        ]
      },
      {  # s4 收束（回和放处对账）
        "desc": "回东市·南巷，把断好的账还给和放",
        "targets": [go("hk_npcv_241_yinzi_go3", "jn_market_south", "回南巷对账")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("和放把三样东西并排摊开：柜上的窟窿、米行的进项、架阁库缺页的印。三处的日子，对上了。"),
          say("「东家跑得不冤。」他把算盘一推，「这笔账，看你怎么记。」"),
          menu("这笔账|断到东家头上，行会存档>+rep:朝廷:15;+exp:160;favor:npcv_241:20;incvar:favor_npcv_241:20;flag:j2b_yinzi_done;;只告诉和放一个人>+money:100;+exp:120;favor:npcv_241:35;incvar:favor_npcv_241:35;flag:j2b_yinzi_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 2 · 穆逢「妆匣最底下那张纸」
# =====================================================================
Q = d61['quests']['hk_npcv_154_maishen']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 一船十二个（老茶馆）
        "desc": "去东市·老茶馆，向柳三弦打听三年前进楼的那船姑娘",
        "targets": [go("hk_npcv_154_maishen_go1", "jn_teahouse", "去老茶馆打听旧事")],
        "next": 2,
        "effects": [
          narr("柳三弦把三弦搁在膝上，醒木没动。「三年前水路上来一船姑娘，十二个，牙行领走的。绝食那位，是船尾的。」"),
          say("「船尾的命最贱，也最硬。她上船前咬过人。」"),
          menu("这段旧事|点他一段词，慢慢听>-money:50;+exp:150;+pot:30;flag:j2b_maishen_boat;;开门见山，只问保人>+karma:5;+exp:120;flag:j2b_maishen_boat")
        ]
      },
      {  # s2 刑房旧卷（保人）
        "desc": "去衙门·刑房，翻那船人的旧卷找牙行保人",
        "targets": [go("hk_npcv_154_maishen_go2", "jn_yamen_wt", "去刑房翻旧卷")],
        "next": 3,
        "effects": [
          narr("刑房的旧卷按年码放。三年前水路那一卷里，保人的画押潦草，名字却清楚：保一船，抽三成。"),
          say("当值的书吏把卷宗收回去一半：「牙行的保人换得勤。这一个，去年就换掉了。」"),
          menu("保人的名字|抄下来，往后对人证用得上>+exp:130;flag:j2b_maishen_name;;多塞二十文，问细一点>-money:20;+pot:40;flag:j2b_maishen_name")
        ]
      },
      {  # s4 收束（二楼雅间）
        "desc": "上醉仙楼·二楼雅间，把那张纸的去向定下来",
        "targets": [go("hk_npcv_154_maishen_go3", "jn_wine_room", "上二楼雅间回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("穆逢的妆匣开着，那张纸压在最底下。船尾的姑娘在楼下，绝食第四天。"),
          say("穆逢笑着报价：「纸是楼里的，人也是楼里的。」笑意到一半，收了。"),
          menu("那张纸|当着穆逢的面烧了，人算楼里白养三年>+karma:15;+exp:180;favor:npcv_154:-25;incvar:favor_npcv_154:-25;flag:j2b_maishen_done;;押着契，换姑娘的赎身钱>+money:150;+karma:-10;+exp:140;flag:j2b_maishen_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 3 · 屈疏「府学门口那道门」
# =====================================================================
Q = d61['quests']['hk_npcv_010_fuxue']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"and": [{"questDone": "hk_npcv_010_haosun"}, {"flag": "jiuye_done"}]}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 名额的去向（翰墨斋后堂）
        "desc": "去翰墨斋·后堂，问闵守府学的名额让给了谁",
        "targets": [go("hk_npcv_010_fuxue_go1", "jn_study_1", "去翰墨斋后堂找闵守")],
        "next": 2,
        "effects": [
          narr("闵守抄书的手没停。「寒文名额三年一放，放的都是交得起炭敬的人家。我家那一份，让了。」"),
          say("「炭敬不伤人。伤人的是，你让了，也没人记得你让过。」"),
          menu("名额的账|替他抄一沓书，换一句实话>+exp:140;favor:npcv_102:10;incvar:favor_npcv_102:10;flag:j2b_fuxue_list;;问炭敬的数目，自己掂量>-money:50;+pot:40;flag:j2b_fuxue_list")
        ]
      },
      {  # s2 门房的规矩（再访书院）
        "desc": "回白鹿书院·讲堂，从门房嘴里掏名额的真规矩",
        "targets": [go("hk_npcv_010_fuxue_go2", "jn_school", "回书院找门房")],
        "next": 3,
        "effects": [
          narr("门房这回没说名额满了。他往讲堂里努了努嘴：「名额在教谕手里。帖子递得进去，门就开。」"),
          say("「名帖上写谁的名字不要紧。要紧的是，帖子上得有一句教谕想听的话。」"),
          menu("这道门|花八十文备一份像样的名帖>-money:80;+karma:5;+exp:130;flag:j2b_fuxue_gate;;让孩子自己再考一回，凭卷子>+exp:160;+pot:40;flag:j2b_fuxue_gate")
        ]
      },
      {  # s4 收束（西巷）
        "desc": "回东市·西巷，把名额的走法告诉屈疏",
        "targets": [go("hk_npcv_010_fuxue_go3", "jn_market_west", "回西巷回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("屈疏听完，扳指在指头上转了两圈。「炭敬我出得起。可我这辈子没求过人。这是头一回，为儿子求。」"),
          say("「帖子你替我递。求人这条路，我不熟，你熟。」"),
          menu("递帖子|替他把帖子递了，门开在哪天算哪天>+karma:8;+exp:170;favor:npcv_010:30;incvar:favor_npcv_010:30;flag:j2b_fuxue_done;;把路数教给孩子，让他自己走>+exp:150;+pot:50;favor:npcv_010:20;incvar:favor_npcv_010:20;flag:j2b_fuxue_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 4 · 邬修远「三年攒的那匹绸」
# =====================================================================
Q = d61['quests']['hk_npcv_240_laocaifeng']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 上家的船（北巷）
        "desc": "回东市·北巷，问邬修远那批便宜绸的上家",
        "targets": [go("hk_npcv_240_laocaifeng_go1", "jn_market_north", "回北巷问上家")],
        "next": 2,
        "effects": [
          narr("邬修远一拍大腿：「上家走水路，三船绸，价钱只有市价的一半。我贪那个价，进了三十匹。」"),
          say("「船是上个月靠的岸。上家如今找不着了。找着了，我也说不出口，人家待我不薄。」"),
          menu("货底怎么看|把三十匹全拆验，一匹一匹来>+exp:150;+pot:40;flag:j2b_silk_boat;;只问船期的账，不动货>+exp:120;+karma:5;flag:j2b_silk_boat")
        ]
      },
      {  # s2 同批的受害人（市集）
        "desc": "去江南城·市集，查同批掺麻绸还流进了谁的柜上",
        "targets": [go("hk_npcv_240_laocaifeng_go2", "jiangnan_market", "去市集查同批货")],
        "next": 3,
        "effects": [
          narr("市集上转了一圈，当铺的柜上压着一匹同批的绸，剪口里一样的麻丝。熊时的折扇点着那匹料子：「进价低得蹊跷，收的时候我就疑心。」"),
          say("「疑心归疑心，账上不能写疑心。写了，我这柜子就不用开了。」"),
          menu("证词怎么记|把两家的剪口对在一起，串成证据>+karma:5;+exp:140;flag:j2b_silk_proof;;给熊时留个面子，压下不说>+money:60;+karma:-5;+exp:110;flag:j2b_silk_proof")
        ]
      },
      {  # s4 收束（北巷）
        "desc": "回东市·北巷，帮邬修远把这三年的账收个尾",
        "targets": [go("hk_npcv_240_laocaifeng_go3", "jn_market_north", "回北巷收尾")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("三十匹掺麻的绸在铺子里码成一垛。邬修远坐在垛边上，半天没说话。"),
          say("「三年攒的本钱，折在一个月里。」他拍拍那垛绸，「你说，往后这铺子还开不开？」"),
          menu("退本金|拉着行会去找上家的保人，讨回本金>+rep:朝廷:10;+exp:170;favor:npcv_240:35;incvar:favor_npcv_240:35;flag:j2b_silk_done;;认折损，改行卖麻布>+money:120;+karma:-8;+exp:130;flag:j2b_silk_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 5 · 乐知「北边那趟镖」
# =====================================================================
Q = d61['quests']['hk_npcv_180_beibian']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"and": [{"flag": "jiuye_done"}, {"not": {"flag": "know_zhenyi"}}]}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 封条上的字号（老茶馆）
        "desc": "去东市·老茶馆，从柳三弦的词里找封条上那家货栈",
        "targets": [go("hk_npcv_180_beibian_go1", "jn_teahouse", "去老茶馆对字号")],
        "next": 2,
        "effects": [
          narr("柳三弦的词里有这家字号：黑水集的顺记货栈。词里唱它「三年不歇脚，货比人先到」，说的是那家栈从不留人过夜。"),
          say("「词是编的，字号是真的。押过它家货的镖师，回来就没再接过第二趟。」"),
          menu("这段词|点一整段，把字号的下落听全>-money:50;+exp:150;+pot:40;flag:j2b_biao_mark;;只翻茶客的水单，找同路人>+exp:130;+karma:5;flag:j2b_biao_mark")
        ]
      },
      {  # s2 兵部的火牌（架阁库）
        "desc": "去衙门·架阁库，查那口箱子出的关防文书",
        "targets": [go("hk_npcv_180_beibian_go2", "jn_yamen_arch", "去架阁库查火牌")],
        "next": 3,
        "effects": [
          narr("架阁库的过所底簿里翻到那口箱子的出关记录。兵部火牌，押的是官粮，一路不必开箱。"),
          say("看库的老吏把底簿按住：「火牌倒是真的。粮就不是了。真牌假粮一道走，查的人得先掂量掂量自己。」"),
          menu("底簿这一页|抄下火牌的编号，往后对得上>+rep:朝廷:10;+exp:140;flag:j2b_biao_paper;;只记字号，不落纸面>+exp:130;+pot:40;flag:j2b_biao_paper")
        ]
      },
      {  # s4 收束（东市大街）
        "desc": "回东市·大街，让乐知把这一趟的决定做下来",
        "targets": [go("hk_npcv_180_beibian_go3", "jn_market_main", "回大街找乐知")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("乐知听完，把那块没撕净的旧封条折了折，收进号衣内袋。她把火牌的事说了，又把货栈的事说了。「这一趟拉的不是货。」"),
          say("「镖行的规矩，货出了门就认银子。可我乐知接镖，认的是货单上写的东西。」"),
          menu("这一趟|逼她报官，镖局出面>+rep:朝廷:20;+exp:180;favor:npcv_180:-15;incvar:favor_npcv_180:-15;flag:j2b_biao_done;;劝她箱子原路退回，装不知道>+favor:npcv_180:35;incvar:favor_npcv_180:35;+pot:50;+exp:140;flag:j2b_biao_done")
        ]
      }
    ]
    dirty61 = True
# 朱雀 fixup（幂等：已改造案的老句直接刷成改写句）
_F5 = {
  "「词是编的，字号是真的。真到什么地步？押过它家货的镖师，都没再接过第二趟。」":
  "「词是编的，字号是真的。押过它家货的镖师，回来就没再接过第二趟。」",
  "架阁库的过所底簿里，那口箱子的出关记录写得清楚：兵部火牌，押运官粮，沿途不必开箱。":
  "架阁库的过所底簿里翻到那口箱子的出关记录。兵部火牌，押的是官粮，一路不必开箱。",
  "柳三弦的词里有这家字号：黑水集的顺记货栈。词里唱它「三年不落地，货比人先到」，说的是那家栈从不留人过夜。":
  "柳三弦的词里有这家字号：黑水集的顺记货栈。词里唱它「三年不歇脚，货比人先到」，说的是那家栈从不留人过夜。",
  "看库的老吏把底簿按住：「火牌是真的，粮是假的。真的假的一起走，谁查谁晦气。」":
  "看库的老吏把底簿按住：「火牌倒是真的。粮就不是了。真牌假粮一道走，查的人得先掂量掂量自己。」",
  "乐知听完，把那块没撕净的旧封条折了折，收进号衣内袋。「假粮、火牌、不留人的货栈。这趟镖不是镖，是快递骨头的车。」":
  "乐知听完，把那块没撕净的旧封条折了折，收进号衣内袋。她把火牌的事说了，又把货栈的事说了。「这一趟拉的不是货。」",
}
for _s5 in Q['stages']:
    for _e5 in _s5.get('effects', []):
        if _e5.get('type') in ('narrate', 'say') and _e5.get('raw') in _F5:
            _e5['raw'] = _F5[_e5['raw']]
            dirty61 = True

# =====================================================================
# 案 6 · 熊时「那幅百子图」
# =====================================================================
Q = d61['quests']['hk_npcv_009_baizi']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 喻凝的手（老茶馆）
        "desc": "去东市·老茶馆，向柳三弦打听绣娘喻凝的行情",
        "targets": [go("hk_npcv_009_baizi_go1", "jn_teahouse", "去老茶馆打听绣娘")],
        "next": 2,
        "effects": [
          narr("柳三弦拨了个空弦：「喻凝的手，城里绣行排头一份。一幅百子图，正价二十两打底。她押给熊时，抵的是九两债。」"),
          say("「不是图贱卖。是她男人病着，等钱。绣一幅的工夫，等不起。」"),
          menu("行情怎么问|点茶听他讲绣行的规矩>-money:40;+exp:140;+pot:30;flag:j2b_baizi_needle;;直接去绣行问价，不听词>+exp:120;+karma:5;flag:j2b_baizi_needle")
        ]
      },
      {  # s2 九两债的账（南巷）
        "desc": "去东市·南巷，把九两债的本息算清楚",
        "targets": [go("hk_npcv_009_baizi_go2", "jn_market_south", "去南巷算债")],
        "next": 3,
        "effects": [
          narr("和放把借据摊开：本金九两，三年滚到十四两。喻凝的百子图抵债，作价九两，差的五两她还欠着。"),
          say("「账没有错处。」和放把借据收回去，「错处不在账上。」"),
          menu("这笔账|照借据算清，一文不让>+exp:140;favor:npcv_241:10;incvar:favor_npcv_241:10;flag:j2b_baizi_math;;自己垫十两，替她平账>-money:100;+karma:10;+exp:120;flag:j2b_baizi_math")
        ]
      },
      {  # s4 收束（市集）
        "desc": "回江南城·市集，让熊时把那幅图的去向定下来",
        "targets": [go("hk_npcv_009_baizi_go3", "jiangnan_market", "回市集找熊时")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("熊时把百子图在柜上摊开，九十九个孩子，缺的那个线头还留着。「图是好图。可我收它，收的是债，不是绣活。」"),
          say("「你要真替绣娘想，就把图的价钱和债的数目都摆到桌面上来。摆得平，我就放手。」"),
          menu("那幅图|凑钱替喻凝把图赎回来>-money:200;+karma:15;+exp:170;favor:npcv_009:20;incvar:favor_npcv_009:20;flag:j2b_baizi_done;;让熊时再押一年，等喻凝缓过来>+money:80;+karma:-8;+exp:130;flag:j2b_baizi_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 指路：每案中转房 1 个 room action 钩子（cond=quest 进行中；append 不动原条目）
# =====================================================================
HINTS = [
  ("jn_market_west", "翻米行流水", "翻米行的流水", ["翻流水", "米行流水"],
   "柜上的流水抄得密。三年前那页折了角，折痕压得很深。",
   "hk_npcv_241_yinzi"),
  ("jn_teahouse", "问楼里旧事", "向茶客打听醉仙楼的旧事", ["问旧事", "楼里旧事"],
   "角落里的老茶客压低声音：三年前一船姑娘进了醉仙楼，十二个，如今还剩几个，没人数过。",
   "hk_npcv_154_maishen"),
  ("jn_school", "问门房", "向门房打听府学的规矩", ["问门房", "府学规矩"],
   "门房把名册往柜下一收：「名额的事，别在门口问。进去说话。」",
   "hk_npcv_010_fuxue"),
  ("jiangnan_market", "看当铺告帖", "看当铺门口的告帖", ["看告帖", "告帖"],
   "当铺门口的告帖上新贴了一行小字：北巷绸贩低价出清，行家绕道。",
   "hk_npcv_240_laocaifeng"),
  ("jn_yamen_arch", "翻过所底簿", "翻过所底簿找出关记录", ["翻底簿", "过所底簿"],
   "过所底簿按月分卷。近三个月的卷脊上，兵部火牌那一栏被人翻得起了毛。",
   "hk_npcv_180_beibian"),
  ("jn_market_south", "看行情帖", "看寄卖的行情帖", ["看行情", "行情帖"],
   "行情帖上绣活一栏压着一行批注：百子图正价二十两，押当的九两——谁押谁知道。",
   "hk_npcv_009_baizi"),
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
if dirty61:
    write(P61, d61); print('OK: 61_sidequests（段1 六案 5-stage S3 改造 + require 卷界）')
else:
    print('OK（已落，跳过）: 61_sidequests')
if dirty50:
    write(P50, d50); print('OK: 50_map（段1 六案指路 room action）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------------- 断言 ----------------
v61, v50 = read(P61), read(P50)
CASES = ['hk_npcv_241_yinzi', 'hk_npcv_154_maishen', 'hk_npcv_010_fuxue',
         'hk_npcv_240_laocaifeng', 'hk_npcv_180_beibian', 'hk_npcv_009_baizi']
s0_snapshot = {  # 原池壳 s0 verbatim 快照（menu/raw 逐字）
 'hk_npcv_241_yinzi': ['他把印子账翻到折角那页，指腹压着一行小字，没念出来。', '「白纸黑字，你我都在上头。」'],
 'hk_npcv_154_maishen': ['妆匣最底下压着一张纸，边角磨得起了毛。是张卖身契，落款是三年前。', '「楼里的姑娘，个个都有一张。」'],
 'hk_npcv_010_fuxue': ['门房说，那孩子连来三回，回回被一句「名额满了」挡在外头。', '「我这辈子没求过人。」'],
 'hk_npcv_240_laocaifeng': ['剪口里掺着麻丝，捋一把，扎手。', '「买的人一辈子摸不到里头。」'],
 'hk_npcv_180_beibian': ['箱子里糊着两层棉，压角处留着一块没撕净的旧封条。', '「不写货单的镖，我接过大半辈子。这一趟，我头一回想先看一眼。」'],
 'hk_npcv_009_baizi': ['百子图上九十九个孩子，独缺一个，线头还留着没收。', '「我不写字据。名字，我记在脑子里。」'],
}
MAIN_FLAGS = ('snow_evidence', 'know_zhenyi', 'jiuye_done', 'act1_', 'act2_', 'act3_')
for qid in CASES:
    q = v61['quests'][qid]
    tag = q['name']
    assert len(q['stages']) in (4, 5), tag + ' stage 数不在 4-5'
    s0 = q['stages'][0]
    assert s0.get('next') == 1, tag + ' s0 next 没接上'
    raws = [e.get('raw') for e in s0['effects'] if e.get('type') in ('narrate', 'say')]
    for need in s0_snapshot[qid]:
        assert need in raws, tag + ' s0 原文被动: ' + need[:20]
    menus = [e for s in q['stages'] for e in s.get('effects', []) if e.get('type') == 'menu']
    assert len(menus) >= 2, tag + ' 菜单数不足（原菜单+收束菜单）'
    assert q['stages'][-1].get('lock', {}).get('flag') == 'jiuye_done', tag + ' 收束卷界锁没落'
    assert q['stages'][-1].get('next') == 99, tag + ' 收束 next 不是 99'
    rw = json.dumps(q.get('rewards'), ensure_ascii=False)
    assert q.get('rewards'), tag + ' rewards 丢了'
    assert 'quest' not in rw and not any(f in rw for f in MAIN_FLAGS), tag + ' rewards 并了主线'
    # require
    if qid == 'hk_npcv_180_beibian':
        assert q['require'] == {"and": [{"flag": "jiuye_done"}, {"not": {"flag": "know_zhenyi"}}]}, tag + ' require 被动'
    elif qid == 'hk_npcv_010_fuxue':
        assert q['require'] == {"and": [{"questDone": "hk_npcv_010_haosun"}, {"flag": "jiuye_done"}]}, tag + ' require 被动'
    else:
        assert q['require'] == {"flag": "jiuye_done"}, tag + ' require 被动'
    # targets 房全存在
    for s in q['stages']:
        for t in s.get('targets', []):
            assert t['key'] in v50['rooms'], tag + ' 目标房悬空: ' + t['key']
    # 新写文本无破折号
    blob = json.dumps(q['stages'][1:], ensure_ascii=False)
    assert '——' not in blob, tag + ' 破折号混入'

for rid, cmd, _label, _kws, _text, qid in HINTS:
    acts = v50['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路动作没落'
# 原有条目未被指路动作挤掉
assert any(a.get('cmd') == 'list 绸缎庄' for a in v50['rooms']['jn_silk_shop']['actions'])
assert any(a.get('cmd') == 'listen 说书' for a in v50['rooms']['jn_teahouse']['actions'])
assert any(a.get('cmd') == 'ask 夫子 about 学问' for a in v50['rooms']['jn_school']['actions'])
print('断言全过：段1 六案 5-stage / s0 verbatim / 菜单≥2 / s4 卷界锁 / require / rewards 不并主线 / 目标房全存在 / 指路 6 处 / 无破折号')
