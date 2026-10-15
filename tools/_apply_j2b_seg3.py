#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j2b_seg3.py —— 批4·卷二第二批 分段3/4（design/97 §九.4 #4，游有方 2026-10-16）
----------------------------------------------------------------
段3 六案 = 61 收尾 2 案 + 67 池前 4 案：
  毕元(那册孤本)/和苍(功德箱里那点钱)/
  胡录事(签押房那份底档)/闵守(那一届的考题)/庞听(多出来的一批棉)/元若(雅间那二两茶钱)
67 池改造法：已是 2-stage 成形案（s0 现场+收束）——s0 verbatim（next 1→2）、
  插 2 个新 stage、原收束 stage 原样后移并加 stage.lock=pre_a2_menfang
  （q_main_sect s1「铜牌来路·签押房」的同场咬合：铜牌线到签押房，底档案才见底）。
🔴 悬空连修（67 池原生 bug，本批必修）：ledger 收束 jn_yizhuang、junxu 收束
  jn_granary 两房不存在——收束永远走不到。改 jn_resident_2（杏花巷旧宅）/
  jn_harbor_shed（码头·货栈），desc 与 narrate 同步最小改。
幂等：内容比对，两连跑 OK。写盘：61/67/50_map 均 indent=2+尾换行。
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

P61 = os.path.join(ROOT, 'game', 'data', '61_sidequests.json')
P67 = os.path.join(ROOT, 'game', 'data', '67_sidequests2.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

d61, d67, d50 = read(P61), read(P67), read(P50)
dirty61 = dirty67 = dirty50 = False

LOCK_J2 = {"flag": "jiuye_done", "name": "卷二·风起",
           "msg": "这桩事还没到能见底的时候。东边的路没开，话就还没处说。"}
LOCK_A2 = {"flag": "pre_a2_menfang", "name": "卷二·铜牌来路",
           "msg": "铜牌的来路还没到签押房。这一层，等门房的事了了再谈。"}

def go(stage_id, room, hint):
    return {"id": stage_id, "kind": "room", "key": room, "count": 1,
            "var": stage_id, "desc": hint}

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def menu(t): return {"type": "menu", "raw": t}

# =====================================================================
# 案 13 · 毕元「那册孤本」（61）
# =====================================================================
Q = d61['quests']['hk_npcv_083_guben']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 改的是哪一行（刑房）
        "desc": "去衙门·刑房，调他改过判词的那桩案卷",
        "targets": [go("hk_npcv_083_guben_go1", "jn_yamen_wt", "去刑房调案卷")],
        "next": 2,
        "effects": [
          narr("刑房的案卷按年归档。翻到那一年，判词的抄件与底档并排放着：底档上那行字被人用朱笔圈过，圈了不止一遍。"),
          say("当值书吏把底档收回去：「圈卷的是胡录事。他与毕大人一个库房坐了十九年。」"),
          menu("案卷这一页|照抄圈过的那行，留个凭据>+exp:140;flag:j2b_guben_case;;只问一句：圈了几年>+exp:130;+pot:40;flag:j2b_guben_case")
        ]
      },
      {  # s2 孤本的价（南巷）
        "desc": "去东市·南巷，让和放估一估那册孤本的价",
        "targets": [go("hk_npcv_083_guben_go2", "jn_market_south", "去南巷问书价")],
        "next": 3,
        "effects": [
          narr("和放翻开书页，手指在纸面上停了停。「宋版，白麻纸，初印。三百两起，遇着识货的，翻一倍。」"),
          say("「毕元拿它压判词。压的不是书，是他自己那点心虚。」"),
          menu("这个价|记下，往后对证用得上>+exp:140;+karma:5;flag:j2b_guben_price;;出一百两定金，表示诚心买>-money:100;+exp:120;flag:j2b_guben_price")
        ]
      },
      {  # s4 收束（架阁库）
        "desc": "回衙门·架阁库，让毕元给那册孤本一个去处",
        "targets": [go("hk_npcv_083_guben_go3", "jn_yamen_arch", "回架阁库回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("毕元听完，把洗得发白的笔搁回笔山。「我改那一行的时候，图的就是这册书。如今看来，图错了。」"),
          say("「书是好书。判词是赃的。两样放在一起，书也脏了。」"),
          menu("那册孤本|替他呈给学政，书归公家>+rep:朝廷:15;+exp:170;favor:npcv_083:20;incvar:favor_npcv_083:20;flag:j2b_guben_done;;让他自己把书送回去，只当借过>+favor:npcv_083:35;incvar:favor_npcv_083:35;+karma:10;+exp:150;flag:j2b_guben_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 14 · 和苍「功德箱里那点钱」（61）
# =====================================================================
Q = d61['quests']['hk_npcv_126_xianghuo']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 老碑上的铜像（破庙=城隍庙？两庙区分——用城隍庙碑）
        "desc": "去城西·破庙，读庙外老碑上铜像的来历",
        "targets": [go("hk_npcv_126_xianghuo_go1", "jiangnan_temple", "去破庙读老碑")],
        "next": 2,
        "effects": [
          narr("老碑风化得厉害，碑文还认得出几行：信女捐铜像一尊，高四尺，重六十斤。落款是二十一年前。"),
          say("庞南枝在碑边扫落叶：「这碑我扫了七年。铜像没了以后，来拜的人少了一半。」"),
          menu("碑文这一段|拿纸拓下来，留着对证>+exp:140;flag:j2b_xianghuo_bei;;多扫一会落叶，听她讲那尊像>+exp:130;+pot:40;flag:j2b_xianghuo_bei")
        ]
      },
      {  # s2 铜像的买家（北巷）
        "desc": "去东市·北巷，问邬修远进没进过一尊旧铜像",
        "targets": [go("hk_npcv_126_xianghuo_go2", "jn_market_north", "去北巷问铜像")],
        "next": 3,
        "effects": [
          narr("邬修远一拍大腿：「进过！三年前有人抬来一尊铜像，说是家传的，八十两就出了。我转手卖一百六，还嫌压手。」"),
          say("「买主是外乡人，口音听着像北边的。铜像装了车，往北去了，再没消息。」"),
          menu("买主的话|多问两句，把车行的字号记下>+exp:140;+karma:5;flag:j2b_xianghuo_tong;;不追问，只记个价钱>+exp:130;flag:j2b_xianghuo_tong")
        ]
      },
      {  # s4 收束（丐帮破庙）
        "desc": "回城西·破庙，把钱和铜像的事摊开给和苍",
        "targets": [go("hk_npcv_126_xianghuo_go3", "gaibang_po_miao", "回破庙回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("和苍把功德箱里的钱倒出来，数了三遍，数目没变。「铜像的事，我知道。卖铜像的人，我也知道。」"),
          say("「阿弥陀佛。庙穷，佛不穷。这箱里的钱，一天够两个人的粥。」"),
          menu("香火钱|凑一凑，把铜像塑回来>-money:120;+karma:12;+exp:170;favor:npcv_126:25;incvar:favor_npcv_126:25;flag:j2b_xianghuo_done;;钱留着熬粥，铜像的事不提>+favor:npcv_126:35;incvar:favor_npcv_126:35;+pot:50;+exp:150;flag:j2b_xianghuo_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 15 · 胡录事「签押房那份底档」（67）
# =====================================================================
Q = d67['quests']['hk_bureau_clerk_ledger']
if len(Q.get('stages') or []) == 2 and Q['stages'][0].get('next') == 1:
    Q['require'] = {"flag": "jiuye_done"}
    s1 = Q['stages'][1]  # 原收束，后移为 s3
    new_stages = [
      {  # s1 抽页的人（刑房）
        "desc": "去衙门·刑房，对一对抽页的断口与那晚的名帖",
        "targets": [go("hk_bureau_clerk_ledger_goA", "jn_yamen_wt", "去刑房对断口")],
        "next": 2,
        "effects": [
          narr("刑房的帖子簿上，那晚名帖的纸与旧档的断口对上了：同一家纸坊的帘纹，连裁纸的手法都一样。"),
          say("书吏把两样东西分开收好：「同一个人。抽档在前，递帖在后。他先取了东西，再来问东西的下落。」"),
          menu("断口的样子|描一份，往后对证用得上>+exp:150;flag:j2b_ledger_tear;;不落纸，记在心里>+pot:50;flag:j2b_ledger_tear")
        ]
      },
      {  # s2 架阁库的问路人（架阁库）
        "desc": "去衙门·架阁库，看东厂的人问没问过同一卷档",
        "targets": [go("hk_bureau_clerk_ledger_goB", "jn_yamen_arch", "去架阁库探问")],
        "next": 3,
        "effects": [
          narr("看库的老吏记得清楚：半个月前有人来问十九年前那卷档，出示的是东厂的腰牌。卷宗早被抽走三页，那人翻完没说话。"),
          say("「他们没吵没闹。问完就走。走的时候，把翻过的卷子按原样放回去了。」"),
          menu("腰牌的编号|记下编号，往后对得上>+rep:朝廷:10;+exp:150;flag:j2b_ledger_pai;;按兵不动，只看他们还来不来>+exp:130;+pot:40;flag:j2b_ledger_pai")
        ]
      },
      s1,  # 原收束 verbatim（义庄旧址→悬空修复在下方统一处理），挂铜牌锁
    ]
    s1['next'] = 99
    s1['lock'] = dict(LOCK_A2)
    Q['stages'] = [Q['stages'][0]] + new_stages[:2] + [s1]
    dirty67 = True

# =====================================================================
# 案 16 · 闵守「那一届的考题」（67）
# =====================================================================
Q = d67['quests']['hk_npcv_102_panchang']
if len(Q.get('stages') or []) == 2 and Q['stages'][0].get('next') == 1:
    Q['require'] = {"flag": "jiuye_done"}
    s1 = Q['stages'][1]
    new_stages = [
      {  # s1 盘缠的账（西巷）
        "desc": "去东市·西巷，算一算抄书的工钱与去洛阳的盘缠",
        "targets": [go("hk_npcv_102_panchang_goA", "jn_market_west", "去西巷算盘缠")],
        "next": 2,
        "effects": [
          narr("西巷米行的墙上贴着当季粮价。照闵守抄一页三文的工钱算，攒够去洛阳的盘缠，要抄到明年开春。"),
          say("粮铺掌柜拨着算盘：「乡试的路费，官价八十两。他那一摞书页，抵不上二两。」"),
          menu("这笔账|替他把账算清楚，写给他看>+exp:150;flag:j2b_pan_zhang;;自己贴五两，塞进他的书箱>-money:50;+karma:8;+exp:130;flag:j2b_pan_zhang")
        ]
      },
      {  # s2 姜朝的旧保（书院）
        "desc": "去白鹿书院·讲堂，问夫子姜朝这个人",
        "targets": [go("hk_npcv_102_panchang_goB", "jn_school", "去书院问姜朝")],
        "next": 3,
        "effects": [
          narr("夫子沉了半晌：「姜朝是闵守的业师。当年替他担保买题的，也是姜朝。人故去五年了，债留给了徒弟。」"),
          say("「担保的字据还在我这里。闵守不敢来取，也不敢烧。」"),
          menu("那张字据|劝夫子把字据还给闵守，当面烧了>+karma:10;+exp:150;flag:j2b_pan_shi;;只听不问，字据留在原处>+exp:130;+pot:40;flag:j2b_pan_shi")
        ]
      },
      s1,  # 原收束 verbatim，挂铜牌锁
    ]
    s1['next'] = 99
    s1['lock'] = dict(LOCK_A2)
    Q['stages'] = [Q['stages'][0]] + new_stages[:2] + [s1]
    dirty67 = True

# =====================================================================
# 案 17 · 庞听「多出来的一批棉」（67）
# =====================================================================
Q = d67['quests']['hk_npcv_109_junxu']
if len(Q.get('stages') or []) == 2 and Q['stages'][0].get('next') == 1:
    Q['require'] = {"flag": "jiuye_done"}
    s1 = Q['stages'][1]
    new_stages = [
      {  # s1 船的吃水（码头货栈）
        "desc": "去码头·货栈，看那三条船装的到底是什么",
        "targets": [go("hk_npcv_109_junxu_goA", "jn_harbor_shed", "去货栈看吃水")],
        "next": 2,
        "effects": [
          narr("货栈的管事拿竹篙点了点三条船的水线：「吃水浅，装的轻。说是军需棉，这吃水倒像装了一船空气。」"),
          say("孔拾月蹲在门槛上嗑瓜子：「轻船走得快，快船赶的是日子。军需赶日子，不赶分量。」"),
          menu("水线这一笔|记下三条船的吃水，往后对得上>+exp:150;flag:j2b_jun_chi;;买管事一壶酒，问船期>-money:30;+exp:130;flag:j2b_jun_chi")
        ]
      },
      {  # s2 二十年前的火牌（架阁库）
        "desc": "去衙门·架阁库，查二十年前那批冬衣的出关存根",
        "targets": [go("hk_npcv_109_junxu_goB", "jn_yamen_arch", "去架阁库查存根")],
        "next": 3,
        "effects": [
          narr("架阁库的旧档里翻到那年的存根：冬衣一批，出关晚半月，押运人那一栏空着。"),
          say("看库的老吏把存根抽出来又放回去：「空着名字的押运，出过事就没人认。这批货的银子，到今天没人领。」"),
          menu("存根这一页|抄下空名的位置，留个凭据>+rep:朝廷:10;+exp:150;flag:j2b_jun_pai;;只记日子，不动档案>+exp:130;+pot:40;flag:j2b_jun_pai")
        ]
      },
      s1,  # 原收束 verbatim（粮仓→悬空修复见下），挂铜牌锁
    ]
    s1['next'] = 99
    s1['lock'] = dict(LOCK_A2)
    Q['stages'] = [Q['stages'][0]] + new_stages[:2] + [s1]
    dirty67 = True

# =====================================================================
# 案 18 · 元若「雅间那二两茶钱」（67）
# =====================================================================
Q = d67['quests']['hk_npcv_073_yajian']
if len(Q.get('stages') or []) == 2 and Q['stages'][0].get('next') == 1:
    Q['require'] = {"flag": "jiuye_done"}
    s1 = Q['stages'][1]
    new_stages = [
      {  # s1 客人的落脚（杏花巷）
        "desc": "去江南城·杏花巷，打听那伙雅间客人落脚的地方",
        "targets": [go("hk_npcv_073_yajian_goA", "jn_resident_2", "去杏花巷打听")],
        "next": 2,
        "effects": [
          narr("杏花巷的住户说，巷尾那进小院半年前租出去，租客夜里进白天出，从不走正门。"),
          say("「房租给的是三倍的价。房主收了钱，连院子都不进。你问那伙人做什么的，我们只管收租。」"),
          menu("那个院子|绕着院墙走一圈，看看进出>+exp:150;flag:j2b_ya_yuan;;给看门的老头二十文，问个时辰>-money:20;+exp:130;flag:j2b_ya_yuan")
        ]
      },
      {  # s2 黄清的卷宗（后衙）
        "desc": "去衙门·后衙，翻黄清压着的那几桩悬案",
        "targets": [go("hk_npcv_073_yajian_goB", "jn_yamen_back", "去后衙翻卷宗")],
        "next": 3,
        "effects": [
          narr("后衙的卷宗堆到齐腰。黄清自己那几桩里，恰好有官粮凭据一案：凭据上盖的印，与雅间里他们说的印子对得上。"),
          say("「这案我压了两年。不是破不了，是递上去的每一条线，都被上一级按住了。」"),
          menu("凭据的印|记下印文的样式，往后对得上>+rep:朝廷:10;+exp:150;flag:j2b_ya_juan;;替她把卷宗按原样码好，不多问>+exp:130;+pot:40;flag:j2b_ya_juan")
        ]
      },
      s1,  # 原收束 verbatim，挂铜牌锁
    ]
    s1['next'] = 99
    s1['lock'] = dict(LOCK_A2)
    Q['stages'] = [Q['stages'][0]] + new_stages[:2] + [s1]
    dirty67 = True

# =====================================================================
# 🔴 悬空连修：ledger 收束 jn_yizhuang→jn_resident_2 / junxu 收束 jn_granary→jn_harbor_shed
# =====================================================================
_led = d67['quests']['hk_bureau_clerk_ledger']['stages'][-1]
for t in _led.get('targets', []):
    if t.get('key') == 'jn_yizhuang':
        t['key'] = 'jn_resident_2'
        t['desc'] = "去杏花巷旧宅，那间他连自己都少去的屋子"
        _led['desc'] = "去杏花巷旧宅，那间他连自己都少去的屋子"
        for e in _led.get('effects', []):
            if e.get('type') == 'narrate' and '义庄' in (e.get('raw') or ''):
                e['raw'] = e['raw'].replace('义庄的旧木案底下', '旧宅的木案底下')
        dirty67 = True
_jun = d67['quests']['hk_npcv_109_junxu']['stages'][-1]
for t in _jun.get('targets', []):
    if t.get('key') == 'jn_granary':
        t['key'] = 'jn_harbor_shed'
        t['desc'] = "去码头·货栈，看那批军需的仓房"
        _jun['desc'] = "去码头·货栈，看那批军需的仓房"
        dirty67 = True

# =====================================================================
# 🔴 悬空全修（61+67 两池全扫）：除上述两处外，再修三处既有悬空——
#   69 片已上线案 hk_npcv_223_meimei(gusu_fengqiao)/hk_npcv_174_tuntang(jn_granary)/
#   hk_npcv_237_cheng(jn_yizhuang) + 67 池 hk_npcv_081_xiangzi(jn_granary)。
#   这些案的收束/目标房不存在，玩家按 desc 找不到房——既有实病，本批一并清。
# =====================================================================
def _fix_target(q, old_key, new_key, old_desc_frag, new_desc, narr_fixes=()):
    hit = False
    for st in q.get('stages', []):
        for t in st.get('targets', []):
            if t.get('key') == old_key:
                t['key'] = new_key
                t['desc'] = new_desc
                st['desc'] = new_desc
                hit = True
        for e in st.get('effects', []):
            raw = e.get('raw') or ''
            for a, b in narr_fixes:
                if a in raw:
                    e['raw'] = raw = raw.replace(a, b)
    return hit

FIX_MAP = [
  ('hk_npcv_223_meimei', 'gusu_fengqiao', 'gusu_town',
   '去姑苏·枫桥，跟那个人对质', '去姑苏城外，跟那个人对质',
   (('枫桥', '城外渡口'),)),
  ('hk_npcv_174_tuntang', 'jn_granary', 'jn_market_west',
   '去东市·粮仓，看蒋倦那批米掺了多少', '去东市·西巷米行，看蒋倦那批米掺了多少', ()),
  ('hk_npcv_237_cheng', 'jn_yizhuang', 'jn_resident_2',
   '陪李无咎去城西义庄旧址走一趟', '陪李无咎去杏花巷旧宅走一趟',
   (('义庄', '旧宅'),)),
  ('hk_npcv_081_xiangzi', 'jn_granary', 'jn_harbor_shed',
   '去东市·粮仓，看一眼那口没人认领的箱子', '去码头·货栈，看一眼那口没人认领的箱子', ()),
]
for qid, ok_key, nk, od, nd, nf in FIX_MAP:
    q = d61['quests'].get(qid) or d67['quests'].get(qid)
    if q and _fix_target(q, ok_key, nk, od, nd, nf):
        dirty61 = dirty61 or qid in d61['quests']
        dirty67 = dirty67 or qid in d67['quests']

# =====================================================================
# 指路：6 个 room action 钩子
# =====================================================================
HINTS = [
  ("jn_yamen_wt", "调改过的判词", "调刑房里改过的判词卷", ["调案卷", "改过的判词"],
   "刑房案架上那几年的卷宗里，有一册的书脊比别的旧。翻开来，判词上圈着一道朱笔。",
   "hk_npcv_083_guben"),
  ("jiangnan_temple", "读庙外老碑", "读破庙外的老碑", ["读碑", "老碑"],
   "庙外老碑风化得厉害。捐铜像那一行还认得出，落款的年份被香灰糊了半边。",
   "hk_npcv_126_xianghuo"),
  ("jn_yamen_store", "翻缺页的旧档", "翻库房里被抽过页的旧档", ["翻旧档", "缺页"],
   "库房深处那卷旧档的断口齐整。抽页的人挑的三页，都是同一年的。",
   "hk_bureau_clerk_ledger"),
  ("jn_market_west", "看当季粮价", "看米行墙上当季的粮价", ["看粮价", "粮价"],
   "米行墙上的粮价一年比一年高。照这价算，攒一份乡试的盘缠，得抄三千页书。",
   "hk_npcv_102_panchang"),
  ("jn_harbor", "看码头的船期牌", "看码头上挂的船期牌", ["看船期", "船期牌"],
   "船期牌上三条船的日子挤在同一天。船家的规矩，同天走的船，吃水都不能深。",
   "hk_npcv_109_junxu"),
  ("jn_yamen_back", "翻悬案的卷宗", "翻后衙压着的悬案卷宗", ["翻卷宗", "悬案"],
   "后衙廊下的卷宗堆了半人高。最上头那册的封皮写着官粮二字，边角卷了又压平。",
   "hk_npcv_073_yajian"),
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
    write(P61, d61); print('OK: 61_sidequests（段3 之毕元/和苍两案）')
else:
    print('OK（已落，跳过）: 61_sidequests')
if dirty67:
    write(P67, d67); print('OK: 67_sidequests2（段3 四案改造 + 悬空 target 两处连修）')
else:
    print('OK（已落，跳过）: 67_sidequests2')
if dirty50:
    write(P50, d50); print('OK: 50_map（段3 六案指路 room action）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------------- 断言 ----------------
v61, v67, v50 = read(P61), read(P67), read(P50)
S0_61 = {
 'hk_npcv_083_guben': ['他写完判词，把笔在清水里洗了三遍，洗得笔尖不剩一点墨。', 'hk_npcv_083_guben_swap'],
 'hk_npcv_126_xianghuo': ['和苍数钱的手停了一下，又数下去。', 'hk_npcv_126_xianghuo_share'],
}
for qid, (need_raw, need_flag) in S0_61.items():
    q = v61['quests'][qid]; tag = q['name']
    assert len(q['stages']) in (4, 5), tag + ' stage 数不对'
    raws = [e.get('raw') or '' for e in q['stages'][0]['effects'] if e.get('type') in ('narrate', 'say')]
    assert any(need_raw in r for r in raws), tag + ' s0 原文被动'
    menus = [e for s in q['stages'] for e in s.get('effects', []) if e.get('type') == 'menu']
    assert 'flag:' + need_flag in menus[0]['raw'], tag + ' s0 原菜单 flag 被动'
    assert len(menus) >= 2 and q['stages'][-1]['lock']['flag'] == 'jiuye_done', tag + ' 收束锁/菜单不足'
    assert q['require'] == {"flag": "jiuye_done"}, tag + ' require 被动'
    blob = json.dumps(q['stages'][1:], ensure_ascii=False)
    assert '——' not in blob, tag + ' 破折号混入'
S0_67 = {
 'hk_bureau_clerk_ledger': ['「抽页的人，手比你稳。」', 'hk_bureau_clerk_ledger_sell'],
 'hk_npcv_102_panchang': ['「再抄三千页，兴许就够了。」', 'hk_npcv_102_panchang_pay'],
 'hk_npcv_109_junxu': ['「货走水路，利钱厚，担的风险也厚。你替我盯着。」', 'hk_npcv_109_junxu_done'],
 'hk_npcv_073_yajian': ['「借你这间屋子说话，是因为你这张嘴严。」', 'hk_npcv_073_yajian_cover'],
}
for qid, (need_raw, need_flag) in S0_67.items():
    q = v67['quests'][qid]; tag = q['name']
    assert len(q['stages']) == 4, tag + ' 67 案 stage 数应为 4（s0+2 新+原收束）'
    raws = [e.get('raw') or '' for e in q['stages'][0]['effects'] if e.get('type') in ('narrate', 'say')]
    assert any(need_raw in r for r in raws), tag + ' s0 原文被动'
    last = q['stages'][-1]
    ml = [e for e in last.get('effects', []) if e.get('type') == 'menu']
    assert ml and 'flag:' + need_flag in ml[0]['raw'], tag + ' 原收束菜单被动'
    assert last.get('lock', {}).get('flag') == 'pre_a2_menfang', tag + ' 铜牌锁没落'
    assert q['require'] == {"flag": "jiuye_done"}, tag + ' require 被动'
    blob = json.dumps(q['stages'][1:3], ensure_ascii=False)  # 新插段
    assert '——' not in blob, tag + ' 破折号混入'
# 悬空修复断言
assert all(t['key'] != 'jn_yizhuang' and t['key'] != 'jn_granary'
           for q in v67['quests'].values() for s in q['stages'] for t in s.get('targets', [])), '悬空 target 没修净'
_led2 = v67['quests']['hk_bureau_clerk_ledger']['stages'][-1]
assert _led2['targets'][0]['key'] == 'jn_resident_2' and '义庄' not in _led2['desc'], 'ledger 收束没改净'
assert not any('义庄' in (e.get('raw') or '') for e in _led2['effects']), 'ledger narrate 义庄残留'
_jun2 = v67['quests']['hk_npcv_109_junxu']['stages'][-1]
assert _jun2['targets'][0]['key'] == 'jn_harbor_shed', 'junxu 收束没改净'
for _q69 in ('hk_npcv_223_meimei', 'hk_npcv_174_tuntang', 'hk_npcv_237_cheng'):
    _qq = v61['quests'].get(_q69)
    if _qq:
        assert all(t['key'] not in ('gusu_fengqiao', 'jn_granary', 'jn_yizhuang')
                   for s2 in _qq['stages'] for t in s2.get('targets', [])), _q69 + ' 悬空没修'
# 全部 target 房存在（61+67 两池全扫）
for src, pool in (('61', v61['quests']), ('67', v67['quests'])):
    for qid, q in pool.items():
        for s in q.get('stages', []):
            for t in s.get('targets', []):
                assert t['key'] in v50['rooms'], src + ':' + qid + ' 目标房悬空: ' + t['key']
for rid, cmd, qid in [(h[0], h[1], h[5]) for h in HINTS]:
    acts = v50['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路动作没落'
print('断言全过：段3 六案 / 61 s0 verbatim / 67 原文全留+原收束后移 / 铜牌锁 pre_a2_menfang / 悬空 target 两处连修净 / 全两池 target 房存在 / 指路 6 处 / 无破折号')
