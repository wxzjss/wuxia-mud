#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_act3_cases.py —— 卷三第一批 4 案落盘（design/102，游有方 2026-10-14）
----------------------------------------------------------------
S3 范式：池壳 1-stage 深改造成 4-5 stage 完整案；know_zhenyi 前置收口
**不并主线 rewards**（89 §五：半交结局=chen_chaoben 在手）。
分段落盘纪律：本跑先落案 1（陈语冰，发版门槛件），案 2-4 逐案追加。
幂等：内容比对，两连跑 OK。
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
P65 = os.path.join(ROOT, 'game', 'data', '65_mainline_act3.json')

# =====================================================================
# 案 1 · 陈语冰「那个名额」（5 stage，收束件·发版门槛）
# =====================================================================
Q1 = {
  "id": "hk_npcv_252_minge",
  "name": "那个名额",
  "type": "支线",
  "npc": "npcv_252",
  "giver": "npcv_252",
  "level": 8,
  "desc": "醉春楼一年一个脱籍的名额。教陈语冰认字的那个人，跟她抢同一个。名额是谁捐的，账在千里之外。",
  "require": {"not": {"flag": "know_zhenyi"}},
  "stages": [
    {  # s0 接案（原池壳 verbatim）
      "desc": "去醉春楼花厅，找梅拾问名额的事",
      "targets": [{"id": "go0", "kind": "room", "key": "jn_brothel_hall", "count": 1,
                   "var": "hk_npcv_252_minge_go0", "desc": "去醉春楼花厅，找梅拾问名额的事"}],
      "next": 1,
      "effects": [
        {"type": "say", "raw": "「梅拾教我认字那天，我记着呢。楼里就一个名额。」"},
        {"type": "narrate", "raw": "她把桌上的字帖翻过去，压在底下。"},
        {"type": "menu", "raw": "那个名额|劝她让贤>+karma:15;+exp:240;+pot:60;favor:npcv_219:40;incvar:favor_npcv_219:40;favor:npcv_252:-20;incvar:favor_npcv_252:-20;flag:hk_npcv_252_minge_yield;;替她争到>+money:200;+karma:-15;+exp:150;favor:npcv_252:30;incvar:favor_npcv_252:30;flag:hk_npcv_252_minge_win"}
      ]
    },
    {  # s1 名额从哪来（捐银户头=盐号，咬合西夏线）
      "desc": "回花厅，问妈妈这名额的银子是哪来的",
      "targets": [{"id": "go1", "kind": "room", "key": "jn_brothel_hall", "count": 1,
                   "var": "hk_npcv_252_minge_go1", "desc": "回花厅，问妈妈捐银的户头"}],
      "next": 2,
      "effects": [
        {"type": "narrate", "raw": "妈妈把捐银的簿子从柜台底下抽出来，翻开，指甲在一行字底下划过去，划了两遍。"},
        {"type": "say", "raw": "「名额不是楼里出的，是个善人捐的。一年一个，捐了三年，一年也没断过。」"},
        {"type": "narrate", "raw": "簿子上那行字写的是个盐号。户头落在西夏，钱从盐滩上来，走的是官驿。"},
        {"type": "menu", "raw": "捐银的户头|托同门的文书过一遍名册>+contrib:本门:30;+exp:150;flag:salt_link_seen;;塞给妈妈一锭茶钱，自己翻底页>-money:100;+exp:100;flag:salt_link_seen"}
      ]
    },
    {  # s2 枕下那个字（桥接 65 现成戏「问抄纸」——chen_chaoben/252_broken 双分支不动）
      "desc": "上雅阁。她认的字是梅拾教的，压在枕头底下的不是字帖（问抄纸）",
      "targets": [{"id": "go2", "kind": "room", "key": "jn_brothel_room", "count": 1,
                   "var": "hk_npcv_252_minge_go2", "desc": "上雅阁，找抄书的陈语冰（问抄纸）"}],
      "next": 3,
      "effects": [
        {"type": "narrate", "raw": "楼梯口挂着帘子，帘子上熏的香三年没换过味。雅阁的门虚掩着，里头的灯只点了一盏。"},
        {"type": "narrate", "raw": "桌上摊着几张纸。她背对着门坐着，手里的笔没停。"}
      ]
    },
    {  # s3 疏勒对货（巴扎·常家货栈——姓常、脸上有块疤，65 问抄纸戏里点过名）
      "desc": "去西域·疏勒巴扎，找姓常的货栈对那批纸的去向",
      "targets": [{"id": "go3", "kind": "room", "key": "xiyu_bazaar", "count": 1,
                   "var": "hk_npcv_252_minge_go3", "desc": "去疏勒巴扎，找常家货栈"}],
      "next": 4,
      "effects": [
        {"type": "narrate", "raw": "巴扎西头的货栈挂着两块牌子，一块汉文一块回鹘文。掌柜的姓常，左脸一块疤，正是当年装货的人。"},
        {"type": "say", "raw": "「往西的货我只认两样，盐和纸。盐压秤，纸不压秤，可纸比盐金贵。」"},
        {"type": "narrate", "raw": "他从柜里抽出一张运单的底子。纸走的是疏勒往黑水那条道，交货的日子写在角上，墨都洇了。"},
        {"type": "menu", "raw": "运单的底子|问他那批纸的收货人>+exp:130;flag:cha_route_known;;不问收货人，只把日子记在心里>+karma:5;+exp:110;flag:cha_route_known"}
      ]
    },
    {  # s4 卷终抉择（know_zhenyi 前置锁——半交结局=chen_chaoben 在手，不并主线 rewards）
      "desc": "卷三见了底。回花厅，那半页字该有个去处",
      "lock": {"flag": "know_zhenyi", "name": "卷三·伪秘籍", "msg": "这桩事还没到见底的时候。先把卷三走完，字的事，卷终再谈。"},
      "targets": [{"id": "go4", "kind": "room", "key": "jn_brothel_hall", "count": 1,
                   "var": "hk_npcv_252_minge_go4", "desc": "回花厅，了结那半页字"}],
      "next": 99,
      "effects": [
        {"type": "narrate", "raw": "花厅的灯还跟三年前一样亮。你身上那半页字，如今有了两种去处，梅拾哪一种都不问。"},
        {"type": "menu", "raw": "那半页字|托人递进东厂>+rep:朝廷:30;+exp:200;-item:wulin_zhenyi_chaoben:1;unflag:chen_chaoben;flag:chen_given;;留在手上，谁也不给>flag:chen_kept"}
      ]
    }
  ],
  "rewards": [
    {"type": "say", "raw": "陈语冰把字帖又翻回来，指腹在第一个字上停了停。"}
  ]
}

# 指路件（各「入口」房——102 §六#2：站在接案房怎么知道有这事）
# ① 盐场「问煮盐人」（65 现成主线证据件）尾补一句捐银——盐册与人名的账之外，
#    还有一笔往南边送的银子。
YANCHANG_TAIL = {"type": "narrate",
  "raw": "他把册子往前推了推，又想起来一桩：「账上还有一笔捐银，年年往南边一座楼里送。户头是个盐号，捐给谁，账房不肯写。」"}
# ② 兴庆集市（xixia_market）talk 追加——街面话版本
MARKET_TALK = "兴庆的盐号，前几年往南边捐过一笔银子。捐给谁，账房不说，街上当新鲜话讲了三年。"
# ③ 疏勒巴扎（xiyu_bazaar）talk 追加——常家货栈钩子
BAZAAR_TALK = "西头常家货栈只走两样货，盐和纸。常掌柜左脸有块疤，认人不认钱。"

d61, d50, d65 = read(P61), read(P50), read(P65)
dirty61 = dirty50 = dirty65 = False

# =====================================================================
# 案 2 · 阮听「丁春秋的解药」（5 stage，收束件·发版门槛）
# =====================================================================
Q2 = {
  "id": "hk_npcv_090_jieyao",
  "name": "丁春秋的解药",
  "type": "支线",
  "npc": "npcv_090",
  "giver": "npcv_090",
  "level": 9,
  "desc": "阮听在果子摊后坐着，手一按腕子，话就停。丁春秋种在他身上的蛊，发了七年。那碗药救过命，也记着账。",
  "require": {"not": {"flag": "know_zhenyi"}},
  "stages": [
    {  # s0 接案（原池壳 verbatim）
      "desc": "在果子摊听他讲蛊发时的样子",
      "targets": [{"id": "go0", "kind": "room", "key": "jn_fruit_stall", "count": 1,
                   "var": "hk_npcv_090_jieyao_go0", "desc": "在果子摊听他讲蛊发时的样子"}],
      "next": 1,
      "effects": [
        {"type": "narrate", "raw": "他讲到一半，手忽然按住腕子，指节发白，话停了。"},
        {"type": "say", "raw": "「一年一续。续不上，就烂在这里。」"},
        {"type": "menu", "raw": "那味解药|替他再跑一趟星宿海>+exp:260;+pot:70;favor:npcv_090:40;incvar:favor_npcv_090:40;flag:hk_gu;;劝他离开丁春秋>+karma:10;+exp:240;favor:npcv_090:20;incvar:favor_npcv_090:20;flag:hk_npcv_090_jieyao_leave"}
      ]
    },
    {  # s1 妹妹那碗药（含糊其辞版——真相=他自己下的毒，留给姊妹件 hk_npcv_090_meimei 揭底）
      "desc": "再坐回果子摊，问他腕子上那道旧疤",
      "targets": [{"id": "go1", "kind": "room", "key": "jn_fruit_stall", "count": 1,
                   "var": "hk_npcv_090_jieyao_go1", "desc": "问他腕子上的旧疤"}],
      "next": 2,
      "effects": [
        {"type": "narrate", "raw": "他把袖口放下来。放下来之前，你看见腕上那道疤是旧的，肉是新的。"},
        {"type": "say", "raw": "「妹妹的事，不说。说了，你就得替我拿主意。」"},
        {"type": "narrate", "raw": "他往西边看了一眼，把话头掐了。可兜里那包药一直贴身放着，那不是给自己续命的样子。"},
        {"type": "flag", "args": ["ruan_sister_known"]}
      ]
    },
    {  # s2 星宿取药解（药庐——药引要「蛊主本人的一滴血」）
      "desc": "去星宿海·药庐，问解蛊的方子",
      "targets": [{"id": "go2", "kind": "room", "key": "xiyu_herb_hut", "count": 1,
                   "var": "hk_npcv_090_jieyao_go2", "desc": "去星宿海·药庐问方子"}],
      "next": 3,
      "effects": [
        {"type": "narrate", "raw": "药庐的主人听完，把晾药的竹匾往里挪了挪，只留下那块空匾朝着你。"},
        {"type": "say", "raw": "「解蛊不难，难在药引。要蛊主本人的一滴血。你要解的不是一个病人，是他主子。」"},
        {"type": "narrate", "raw": "他写下一味药名，纸包了三层，推过来。「血的事我管不了。药你先拿着，路你自己挑。」"},
        {"type": "menu", "raw": "药引怎么取|托星宿海的同门引路>+contrib:本门:30;+exp:150;flag:ruan_formula_known;;在贺兰隘口找私贩带路>-money:150;+exp:100;flag:ruan_formula_known"}
      ]
    },
    {  # s3 带话（桥接 65 现成戏「问解药」——ruan_cure+star_cure_item / npv090_broken 双分支不动）
      "desc": "回江南果子摊。他托的话你带到了（问解药）",
      "targets": [{"id": "go3", "kind": "room", "key": "jn_fruit_stall", "count": 1,
                   "var": "hk_npcv_090_jieyao_go3", "desc": "回果子摊，找阮听（问解药）"}],
      "next": 4,
      "effects": [
        {"type": "narrate", "raw": "果子摊的果子落了灰，还是没人买。他脚边那只小箱，箱盖扣得比上回更严。"},
        {"type": "narrate", "raw": "他看见你从西边回来，站起来的时候，掌心在裤腿上擦了一下。"}
      ]
    },
    {  # s4 交与不交（know_zhenyi 前置锁——交与不交都不并主线 rewards）
      "desc": "卷三见了底。回药庐，那包药该有个去处",
      "lock": {"flag": "know_zhenyi", "name": "卷三·伪秘籍", "msg": "药的事还没到见分晓的时候。先把卷三走完，人等得起，药也等得起。"},
      "targets": [{"id": "go4", "kind": "room", "key": "xiyu_herb_hut", "count": 1,
                   "var": "hk_npcv_090_jieyao_go4", "desc": "回药庐，了结那包药"}],
      "next": 99,
      "effects": [
        {"type": "narrate", "raw": "药庐的火还生着，空匾还摆在老地方。星宿海的事见了底，那包药如今有两种给法。给谁，谁欠丁春秋一条命。"},
        {"type": "menu", "raw": "那包药|带回去给他，让他断了蛊走人>+favor:npcv_090:30;+exp:200;flag:ruan_free;;交回药庐，换他妹妹出来>+rep:星宿海:20;+exp:200;-item:star_cure_item:1;flag:ruan_stay"}
      ]
    }
  ],
  "rewards": [
    {"type": "say", "raw": "阮听松开按着腕子的手，把摊上那筐果子摆正了些。"}
  ]
}

# 指路：巴扎 talk 追加——「瓶子满了」钩子（问解药戏里阮听托给疏勒货郎的话）
BAZAAR_TALK2 = "有个南边来的汉子托过话，就三个字，瓶子满了。掌柜的听不懂，星宿海的人懂。"

# =====================================================================
# 案 3 · 俞初「三年前那一笔」（两连池壳深改造：jiushui 4 stage + changfu 并入 s3）
# 西夏线取证：snow_evidence_xixia（主线三线 flag 补齐——判定接线归引擎 lane）
# =====================================================================
Q3 = {
  "id": "hk_npcv_248_jiushui",
  "name": "三年前那一笔",
  "type": "支线",
  "npc": "npcv_248",
  "giver": "npcv_248",
  "level": 9,
  "desc": "西夏官道那间冰窖，锁着三年前一批卷宗。俞初自己不敢去开。开了，就得对账。",
  "stages": [
    {  # s0 冰窖假账（jiushui 原壳 verbatim）
      "desc": "去西夏·冰窖，抽出三年前那张假账",
      "targets": [{"id": "go0", "kind": "room", "key": "xixia_ice", "count": 1,
                   "var": "hk_npcv_248_jiushui_go0", "desc": "去西夏·冰窖，抽出三年前那张假账"}],
      "next": 1,
      "effects": [
        {"type": "narrate", "raw": "卷宗里那一页，户头写着一个死人，墨色比别处新。"},
        {"type": "say", "raw": "「她那年才十七。我记得。」"},
        {"type": "menu", "raw": "这张假账|把抄本留在手上>+rep:朝廷:30;+money:200;+exp:230;+pot:60;flag:hk_npcv_248_jiushui_copy;;当她的面烧了>+karma:-20;+money:400;+exp:220;flag:hk_npcv_248_jiushui_burn"}
      ]
    },
    {  # s1 盐册对页（假账户头=顺义盐号平账；双通道：门内文书/工棚混抄）
      "desc": "去盐场，把假账的户头对上盐册",
      "targets": [{"id": "go1", "kind": "room", "key": "xixia_yanchang", "count": 1,
                   "var": "hk_npcv_248_jiushui_go1", "desc": "去盐场对盐册"}],
      "next": 2,
      "effects": [
        {"type": "narrate", "raw": "盐场一排排池子白得晃眼。你把那页账上的户名，对着盐册一栏一栏地翻。"},
        {"type": "say", "raw": "工头眯着眼看了一眼：「这一栏是平账。进项出项对得整整齐齐，齐得像一个人写的。」"},
        {"type": "narrate", "raw": "假账的户头对上了：银子进的是顺义盐号，年年不差一文。差的那一笔，走的是官驿。"},
        {"type": "menu", "raw": "盐册怎么对|亮门内文书的帖子，正经查账>+contrib:本门:30;+exp:150;flag:xixia_salt_ledger;;混进工棚，等管事骂完人>-money:100;+exp:100;flag:xixia_salt_ledger"}
      ]
    },
    {  # s2 官道截信（兴庆驿——盐号的信不进城，出西门上船）
      "desc": "去兴庆驿，截下盐号往黑水的那封信",
      "targets": [{"id": "go2", "kind": "room", "key": "xixia_post", "count": 1,
                   "var": "hk_npcv_248_jiushui_go2", "desc": "去兴庆驿截信"}],
      "next": 3,
      "effects": [
        {"type": "narrate", "raw": "兴庆驿一天三班传信。号牌墙上有一面是顺义盐号的，牌面比别家的亮。"},
        {"type": "say", "raw": "驿卒头也不抬：「盐号的信从来不进城。出了西门直接上船，船认牌不认人。」"},
        {"type": "narrate", "raw": "你截下那封往黑水的信。火漆没干，信皮上没有字，只有一杆秤的印子。"},
        {"type": "menu", "raw": "这封信|照驿里的规矩登记，明着押走>+karma:5;+exp:130;flag:xixia_intercept;;私拆了，把里头的日子抄下来>-karma:5;+exp:150;flag:xixia_intercept"}
      ]
    },
    {  # s3 对账收口（changfu 原壳并入：常拂的账+俞初的页拼上——西夏线取证落定）
      "desc": "回西夏官道，让常拂和俞初把账对上",
      "targets": [{"id": "go3", "kind": "room", "key": "road_xixia_1", "count": 1,
                   "var": "hk_npcv_248_jiushui_go3", "desc": "回西夏官道对账"}],
      "next": 99,
      "effects": [
        {"type": "narrate", "raw": "驿舍的墙薄。常拂把她那本账摊开，俞初把冰窖那页放在旁边。两个页码，对上了。"},
        {"type": "say", "raw": "常拂：「三年前我查出来的那笔，跟这个是同一笔。我革职那天，顺义盐号的东家请了半个衙门喝酒。」"},
        {"type": "narrate", "raw": "盐册、截信、口供，三样凑齐。西夏这条线，到这儿算是走完了。"},
        {"type": "menu", "raw": "常拂的清白|替她把这份对账递上去>+karma:15;+exp:200;favor:npcv_049:40;incvar:favor_npcv_049:40;flag:hk_npcv_248_changfu_clear;;只留给俞初自己看>+exp:150;favor:npcv_248:20;incvar:favor_npcv_248:20"},
        {"type": "flag", "args": ["snow_evidence_xixia"]}
      ]
    }
  ],
  "rewards": [
    {"type": "say", "raw": "俞初把那页卷宗折起，塞回袖子里，拢了拢领口。"}
  ]
}

# 指路：兴庆驿 talk 尾补（驿卒版）+ 冰窖 talk（管钥匙的——账不是冰）
POST_TALK = "三年前有一页账，从这儿发的，没到黑水就没了下落。驿里没人敢提。"
ICE_TALK = "冰窖里头锁的是账，不是冰。要看懂那页账，得拿盐场的册子对着——册子在工棚。"

# =====================================================================
# 案 4 · 北疆血刀侧「哨卡的规矩」（新写，4 stage）
# 冻市铁器摊主线：儿子被拉去雪谷哨卡→望雪台摸哨→送冬衣进哨→半页运单咬合 hm_blood_saber
# =====================================================================
Q4 = {
  "id": "q_bj_shaogui",
  "name": "哨卡的规矩",
  "type": "支线",
  "npc": "npc_bj_smith",
  "giver": "npc_bj_smith",
  "level": 12,
  "desc": "冻市的铁器卖得比官价贱。铁器摊主的儿子被拉去雪谷哨卡当差，三个月没信。",
  "stages": [
    {  # s0 接案（冻市铁器摊——摊主拜托）
      "desc": "在冻市听铁器摊主说儿子的事",
      "targets": [{"id": "go0", "kind": "room", "key": "beijiang_market", "count": 1,
                   "var": "q_bj_shaogui_go0", "desc": "在冻市听铁器摊主说儿子的事"}],
      "next": 1,
      "effects": [
        {"type": "narrate", "raw": "铁器摊主把一柄柴刀放回架上，手在围裙上擦了两遍才开口。"},
        {"type": "say", "raw": "「我儿子开春被拉去雪谷哨卡当差。三个月了，捎回来的话只有一句：一切都好。」"},
        {"type": "narrate", "raw": "他说「一切都好」的时候，把那柄柴刀又拿起来，磨了一下，又放回去。"},
        {"type": "menu", "raw": "这一切都好|应下来，替他往哨卡跑一趟>+exp:200;favor:npc_bj_smith:30;incvar:favor_npc_bj_smith:30;flag:bj_son_worried;;先问清楚哨卡的规矩>+exp:120;flag:bj_son_worried"}
      ]
    },
    {  # s1 摸哨（望雪台数布条——夜里看换防，认出摊主儿子的弓）
      "desc": "去望雪台，夜里看哨卡换防",
      "targets": [{"id": "go1", "kind": "room", "key": "beijiang_lookout", "count": 1,
                   "var": "q_bj_shaogui_go1", "desc": "去望雪台摸哨"}],
      "next": 2,
      "effects": [
        {"type": "narrate", "raw": "望雪台上风大，站一会儿眉毛上就是霜。你数布条，数到第十七条，天黑透了。"},
        {"type": "narrate", "raw": "换防的火把从谷口出来，一队十二个人。走在末尾那个背上的弓，弓梢缠着皮子。摊主说过，那皮子是他亲手给儿子缠的。"},
        {"type": "say", "raw": "「人还活着，走得动，还背着弓。」你在心里把这三样记下来，下山。"},
        {"type": "flag", "args": ["bj_spot_son"]}
      ]
    },
    {  # s2 走一趟雪谷（借送冬衣进哨——双通道：腰牌/烈酒通路）
      "desc": "去雪谷山口，借送冬衣进哨卡",
      "targets": [{"id": "go2", "kind": "room", "key": "beijiang_shankou", "count": 1,
                   "var": "q_bj_shaogui_go2", "desc": "去雪谷山口送冬衣"}],
      "next": 3,
      "effects": [
        {"type": "narrate", "raw": "哨卡的兵卒不看过所，先翻货。他们翻了翻你怀里那包冬衣，翻到那双纳底的棉鞋，手停了一下。"},
        {"type": "say", "raw": "「皮子缠弓梢的那个？他夜里守第二班。东西留下，人你见不着，这是规矩。」"},
        {"type": "menu", "raw": "这趟怎么走|亮门派的腰牌，正经过卡>+contrib:本门:30;+exp:180;flag:bj_met_son;;买两坛冻市的烈酒，给卡上通路>-money:200;+exp:140;flag:bj_met_son"},
        {"type": "narrate", "raw": "东西收进去，出来的时候多了一样：半页折起来的纸，塞在棉鞋帮里。"}
      ]
    },
    {  # s3 收口（儿子托带的不是家书，是半页运单——咬合 hm_blood_saber 人手房名单）
      "desc": "回冻市，把棉鞋里的东西交给摊主",
      "targets": [{"id": "go3", "kind": "room", "key": "beijiang_market", "count": 1,
                   "var": "q_bj_shaogui_go3", "desc": "回冻市交东西"}],
      "next": 99,
      "effects": [
        {"type": "narrate", "raw": "摊主把那半页纸展开。纸上是一张运单的角，写着收件的名字。他一个一个念过去，念到第三个，声音低下去：都是附近后生。"},
        {"type": "say", "raw": "「这不是家书。」他把纸折起来，「这是名单。血刀门往里运的什么，收货的都是谁，我儿子让我看清楚。」"},
        {"type": "menu", "raw": "半页运单|留在摊上，让当爹的收着>+karma:5;+exp:220;favor:npc_bj_smith:40;incvar:favor_npc_bj_smith:40;;描一份底子，往后对人证的时候用得上>+rep:朝廷:20;+exp:220;flag:bj_manifest_copy"},
        {"type": "flag", "args": ["bj_manifest"]}
      ]
    }
  ],
  "rewards": [
    {"type": "say", "raw": "摊主把柴刀从架上取下来，塞进你手里。刀刃雪亮，没用过。"}
  ]
}

# 新 NPC：铁器摊主（完整 def 落 61 npcs 块——40_npcs 不动）
NPC_SMITH = {
  "id": "npc_bj_smith",
  "name": "铁器摊主",
  "gender": "male",
  "room": "beijiang_market",
  "noWander": True,
  "tag": "commoner",
  # 2026-10-15 扫尾②：lore-consistency ④「每个 NPC 都定了性格」——全库闭集
  # 取值域里给这位讲价不张嘴的摊主配 mune（木讷），守卫红消。
  "personality": "mune",
  "desc": "冻市卖铁器的摊主，一双手全是旧茧，讲价的时候把手指头伸出来比，不张嘴。",
  "talk": [
    "「皮子要就现在挑。开春雪一化，虫就上来了。」",
    "「铁器看清楚了再给钱。出了这个市，血刀门的规矩就是规矩了。」"
  ],
  "quests": ["q_bj_shaogui"],
  "actions": [
    {
      "cmd": "问铁器摊主",
      "label": "问铁器摊主儿子的事",
      "keywords": ["问铁器摊主", "铁器摊主", "问摊主"],
      "desc": "哨卡的规矩",
      "cond": {"not": {"quest": "q_bj_shaogui"}},
      "effects": [
        {"type": "narrate", "raw": "他把一柄柴刀放回架上，围裙上的手印一个叠一个。"},
        {"type": "quest", "args": ["q_bj_shaogui", 0]}
      ]
    }
  ]
}

# 指路：望雪台 talk 追加（数布条的老卒指哨卡）
LOOKOUT_TALK = "夜里换防的火把一出谷口就能看见，十二个人一班。数布条的只管数布条，数火把的，心里都有事。"

# ---- 案 1 quest 落 61 ----
cur = d61['quests'].get('hk_npcv_252_minge')
if cur != Q1:
    d61['quests']['hk_npcv_252_minge'] = json.loads(json.dumps(Q1, ensure_ascii=False))
    dirty61 = True

# ---- 案 2 quest 落 61 ----
cur = d61['quests'].get('hk_npcv_090_jieyao')
if cur != Q2:
    d61['quests']['hk_npcv_090_jieyao'] = json.loads(json.dumps(Q2, ensure_ascii=False))
    dirty61 = True

# ---- 案 3 quest 落 61（jiushui 深改造 + changfu 吸收后删除）----
cur = d61['quests'].get('hk_npcv_248_jiushui')
if cur != Q3:
    d61['quests']['hk_npcv_248_jiushui'] = json.loads(json.dumps(Q3, ensure_ascii=False))
    dirty61 = True
if 'hk_npcv_248_changfu' in d61['quests']:
    del d61['quests']['hk_npcv_248_changfu']
    dirty61 = True
# 61 npcs 块里 npcv_248 的 quests 列表去掉 changfu（防悬空引用）
for nid, n in (d61.get('npcs') or {}).items():
    if nid == 'npcv_248' and isinstance(n.get('quests'), list):
        if 'hk_npcv_248_changfu' in n['quests']:
            n['quests'] = [q for q in n['quests'] if q != 'hk_npcv_248_changfu']
            dirty61 = True
# npcv_248 的「找常拂」接案动作也引用已删案——一并清掉（不报错就是不生效族）
if 'npcv_248' in (d61.get('npcs') or {}):
    acts = d61['npcs']['npcv_248'].get('actions') or []
    keep = [a for a in acts if 'hk_npcv_248_changfu' not in json.dumps(a, ensure_ascii=False)]
    if len(keep) != len(acts):
        d61['npcs']['npcv_248']['actions'] = keep
        dirty61 = True
# 画像 hook 第四处悬空（2026-10-15 扫尾①）：hk_npcv_248_changfu 的 hook 块本身。
# 案已删，hook 指向空气——smoke-sidequest ①「画像 hook 全有 quest」红。
# hook 藏两处：40_npcs 的 portrait.hooks（引擎画像层）+ design/portraits-new.json
# 的 hooks（画像源文件）。都删净。幂等：只在有残留时写盘（不重排整文件格式）。
P40 = os.path.join(ROOT, 'game', 'data', '40_npcs.json')
PPOR = os.path.join(ROOT, 'design', 'portraits-new.json')
def _drop_changfu_hook(hooks):
    keep = [h for h in (hooks or []) if h.get('id') != 'hk_npcv_248_changfu']
    return keep, len(keep) != len(hooks or [])
d40 = read(P40)
po248 = d40['npcs']['npcv_248'].setdefault('portrait', {})
kept40, hit40 = _drop_changfu_hook(po248.get('hooks'))
if hit40:
    po248['hooks'] = kept40
    # ⚠ 40_npcs.json 原版是 indent=1 落盘——用通用 write(indent=2) 会把全文件
    # 重排出 7 万行 diff（发布窗不可接受）。专用 indent=1 写，git diff 只剩 hook 块。
    # ⚠⚠ 且**末尾无换行**（smoke-portrait-batch 0.5/3.4/3.7 逐字节断言：
    # 文件 == JSON.stringify(.,null,1)，多一个 \n 就红）。与通用 write 的尾换行口径相反。
    with io.open(P40, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(d40, f, ensure_ascii=False, indent=1)
    print('OK: 40_npcs npcv_248.portrait.hooks 删 changfu hook（悬空清零，indent=1 原格式）')
dpor = read(PPOR)
it248 = dpor['items']['npcv_248']
keptpor, hitpor = _drop_changfu_hook(it248.get('hooks'))
if hitpor:
    it248['hooks'] = keptpor
    write(PPOR, dpor)
    print('OK: portraits-new npcv_248.hooks 删 changfu hook（悬空清零）')

# ---- 案 4 quest + 新 NPC 落 61 ----
cur = d61['quests'].get('q_bj_shaogui')
if cur != Q4:
    d61['quests']['q_bj_shaogui'] = json.loads(json.dumps(Q4, ensure_ascii=False))
    dirty61 = True
if d61.setdefault('npcs', {}).get('npc_bj_smith') != NPC_SMITH:
    d61['npcs']['npc_bj_smith'] = json.loads(json.dumps(NPC_SMITH, ensure_ascii=False))
    dirty61 = True

# ---- 指路 ②③ 落 50_map talk ----
def append_talk(rooms, rid, line):
    talks = rooms[rid].get('talk')
    if talks is None:
        rooms[rid]['talk'] = [line]; return True
    if line not in talks:
        talks.append(line); return True
    return False

if append_talk(d50['rooms'], 'xixia_market', MARKET_TALK):
    dirty50 = True
if append_talk(d50['rooms'], 'xiyu_bazaar', BAZAAR_TALK):
    dirty50 = True
if append_talk(d50['rooms'], 'xiyu_bazaar', BAZAAR_TALK2):
    dirty50 = True
if append_talk(d50['rooms'], 'xixia_post', POST_TALK):
    dirty50 = True
if append_talk(d50['rooms'], 'xixia_ice', ICE_TALK):
    dirty50 = True
if append_talk(d50['rooms'], 'beijiang_lookout', LOOKOUT_TALK):
    dirty50 = True

# ---- 指路 ① 落 65 问煮盐人 尾补 ----
for a in (d65['rooms'].get('xixia_yanchang', {}).get('actions') or []):
    if a.get('cmd') == '问煮盐人':
        effs = a.get('effects') or []
        if not any('捐银' in json.dumps(e, ensure_ascii=False) for e in effs):
            effs.append(json.loads(json.dumps(YANCHANG_TAIL, ensure_ascii=False)))
            a['effects'] = effs
            dirty65 = True

if dirty61:
    write(P61, d61); print('OK: 61 四案齐（1 陈语冰 / 2 阮听 / 3 俞初深改造 / 4 哨卡的规矩+新 NPC 铁器摊主）')
if dirty50:
    write(P50, d50); print('OK: 50_map 指路（兴庆集市 + 巴扎×2 + 兴庆驿 + 冰窖 + 望雪台）')
if dirty65:
    write(P65, d65); print('OK: 65 指路（盐场问煮盐人尾补捐银句）')

# ---------- 断言 ----------
v61, v50, v65 = read(P61), read(P50), read(P65)
q = v61['quests']['hk_npcv_252_minge']
assert len(q['stages']) == 5, '案 1 stage 数不对'
assert q['require'] == {"not": {"flag": "know_zhenyi"}}, 'require 被动了'
assert q['stages'][4].get('lock', {}).get('flag') == 'know_zhenyi', 's4 前置锁没落'
assert q['stages'][0]['effects'][2]['raw'].startswith('那个名额|'), 's0 原菜单被动了'
blob = json.dumps(q, ensure_ascii=False)
assert 'chen_chaoben' in blob and 'salt_link_seen' in blob and 'cha_route_known' in blob
assert MARKET_TALK in (v50['rooms']['xixia_market'].get('talk') or [])
assert BAZAAR_TALK in (v50['rooms']['xiyu_bazaar'].get('talk') or [])
assert BAZAAR_TALK2 in (v50['rooms']['xiyu_bazaar'].get('talk') or [])
yb = json.dumps((v65['rooms']['xixia_yanchang'].get('actions') or []), ensure_ascii=False)
assert '捐银' in yb, '盐场尾句没落'
# 不并主线 rewards 自查：rewards 里不得有 rep:朝廷 / exp 大额
rb = json.dumps(q.get('rewards') or [], ensure_ascii=False)
assert '朝廷' not in rb, 'rewards 并了主线线'

q2 = v61['quests']['hk_npcv_090_jieyao']
assert len(q2['stages']) == 5, '案 2 stage 数不对'
assert q2['require'] == {"not": {"flag": "know_zhenyi"}}, '案 2 require 被动了'
assert q2['stages'][4].get('lock', {}).get('flag') == 'know_zhenyi', '案 2 s4 前置锁没落'
assert q2['stages'][0]['effects'][2]['raw'].startswith('那味解药|'), '案 2 s0 原菜单被动了'
blob2 = json.dumps(q2, ensure_ascii=False)
assert 'ruan_sister_known' in blob2 and 'ruan_formula_known' in blob2 and 'ruan_free' in blob2 and 'ruan_stay' in blob2
assert '星宿海' in blob2 and 'star_cure_item' in blob2, '声望/物件挂点缺'
rb2 = json.dumps(q2.get('rewards') or [], ensure_ascii=False)
assert '星宿海' not in rb2, '案 2 rewards 并了主线线'

q3 = v61['quests']['hk_npcv_248_jiushui']
assert len(q3['stages']) == 4, '案 3 stage 数不对'
blob3 = json.dumps(q3, ensure_ascii=False)
assert 'xixia_salt_ledger' in blob3 and 'xixia_intercept' in blob3 and 'snow_evidence_xixia' in blob3
assert 'hk_npcv_248_changfu_clear' in blob3, 'changfu 抉择没并入'
assert q3['stages'][0]['effects'][2]['raw'].startswith('这张假账|'), '案 3 s0 原菜单被动了'
assert 'hk_npcv_248_changfu' not in v61['quests'], 'changfu 案没删净'
n248 = (v61.get('npcs') or {}).get('npcv_248') or {}
assert 'hk_npcv_248_changfu' not in (n248.get('quests') or []), 'changfu 悬空引用没清'
assert POST_TALK in (v50['rooms']['xixia_post'].get('talk') or [])
assert ICE_TALK in (v50['rooms']['xixia_ice'].get('talk') or [])

q4 = v61['quests']['q_bj_shaogui']
assert len(q4['stages']) == 4, '案 4 stage 数不对'
blob4 = json.dumps(q4, ensure_ascii=False)
assert 'bj_son_worried' in blob4 and 'bj_spot_son' in blob4 and 'bj_met_son' in blob4 and 'bj_manifest' in blob4
ns = v61.get('npcs', {}).get('npc_bj_smith') or {}
assert ns.get('room') == 'beijiang_market' and ns.get('noWander') is True
assert 'q_bj_shaogui' in (ns.get('quests') or []), '新 NPC 没挂案'
grant_acts = json.dumps(ns.get('actions') or [], ensure_ascii=False)
assert 'q_bj_shaogui' in grant_acts, '新 NPC 接案动作没落'
n248b = (v61.get('npcs') or {}).get('npcv_248') or {}
assert 'hk_npcv_248_changfu' not in json.dumps(n248b.get('actions') or []), 'changfu 动作没清'
# 扫尾四钉断言（2026-10-15）
v40 = read(P40); vpor = read(PPOR)
_h40 = [h['id'] for h in (v40['npcs']['npcv_248'].get('portrait') or {}).get('hooks') or []]
assert 'hk_npcv_248_changfu' not in _h40, '40_npcs changfu hook 没删净'
_hpor = [h['id'] for h in (vpor['items']['npcv_248'].get('hooks') or [])]
assert 'hk_npcv_248_changfu' not in _hpor, 'portraits-new changfu hook 没删净'
assert v61['npcs']['npc_bj_smith'].get('personality') == 'mune', '铁器摊主 personality 没落'
assert '哨卡的兵卒不看过所' in json.dumps(v61['quests']['q_bj_shaogui'], ensure_ascii=False), '哨卡 narrate 改写没落'
assert '哨卡验的不是过所' not in json.dumps(v61['quests']['q_bj_shaogui'], ensure_ascii=False), '哨卡旧句残留'
assert LOOKOUT_TALK in (v50['rooms']['beijiang_lookout'].get('talk') or [])
# 全批无破折号（案 2 教训：一个——顶爆 punct）
for _q in ('hk_npcv_252_minge', 'hk_npcv_090_jieyao', 'hk_npcv_248_jiushui', 'q_bj_shaogui'):
    assert '——' not in json.dumps(v61['quests'][_q], ensure_ascii=False), _q + ' 有破折号'
print('断言全过：四案齐整 / 前置锁 / 指路七处 / 原菜单保留 / changfu 删净（含 hook 两处） / 新 NPC 挂案+personality / 哨卡句改写 / 无破折号 / rewards 不并主线')
