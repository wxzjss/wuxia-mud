# -*- coding: utf-8 -*-
"""act1 P2：40_npcs 新增 4 人（周老汉/陈二/瘸腿店主/计掌柜，含 portrait 三槽）+ 63_mainline_act1.json。
文案全部出自 design/74 成稿拆句；剧情零 onEnter（扣着不讲：全走 actions cond flag，玩家追踪才展开）。"""
import json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P40 = os.path.join(BASE, 'game', 'data', '40_npcs.json')
P63 = os.path.join(BASE, 'game', 'data', '63_mainline_act1.json')

def npc_base(id, name, gender, title, room, tag, desc, level, talk, portrait, age=40):
    return {
        'id': id, 'name': name, 'gender': gender, 'title': title, 'tag': tag,
        'desc': desc, 'room': room, 'level': level,
        'hp': level * 22, 'atk': level, 'def': round(level * 0.7, 1),
        'dodge': level, 'speed': level, 'money': 100,
        'hostile': False, 'leavesCorpse': True,
        'talk': talk,
        'likes': ['food'], 'favorBase': 0.7, 'favorInit': 0,
        'age': age, 'tier': 'C', 'district': 'jiangnan', 'province': '江湖',
        'portrait': portrait,
    }

NPCS = {
    'act1_zhou': npc_base(
        'act1_zhou', '周老汉', 'male', '茶摊老汉', 'road_jiangnan_1', 'vendor',
        '左手小指少一节，断口处的皮翻着，早长死了。添水从来不看壶，提起壶就倒，倒到七分停手。',
        12,
        ['坐。', '外乡人。你身上那块布，我看见了。', '三年前腊月按的。按的时候人还在。', '华山。山上有个姓令狐的。', '我不认字，也不认得路。'],
        {'v': 1, 'tier': 'C', 'lock': False,
         'role': '老槐树底下摆茶摊的，摊子一领芦席四根竹竿，有一根是断的',
         'origin': '没离开过城南。这一辈子出过三次远门，最远的一次到过青溪村。',
         'now': '三年前托人往北边送过一封信，没有回音。',
         'want': '想知道那封信到底送到没送到',
         'fear': '怕答案等到人没了才来',
         'voice': {'tone': '省字，说一句是一句', 'catchphrase': '三尺就够。'},
         'routine': [{'at': 'day', 'act': '坐在灶边擦碗，擦完的碗沿和碗沿对齐'}],
         'arc': {'init': '他不看你，只看你的鞋。', 'warm': '他会记着你坐哪条凳，下次提前擦干净。'},
         'marks': ['断指', '估水']},
        63),
    'act1_chen2': npc_base(
        'act1_chen2', '陈二', 'male', '青溪村村民', 'cunzhen_gate', 'farmer',
        '说话前先把手在裤子上擦两遍。蹲在井台边砸冰，砸两下停一停。',
        9,
        ['华山往北。走大路二十里，走小路近五里，小路上有座独木桥。', '你要是走小路，能不能替我带句话？', '你就说一句：娘去年冬天没了，埋在后坡，坟头朝东。', '你要是忘了，就别编。编的比不说还坏。'],
        {'v': 1, 'tier': 'C', 'lock': False,
         'role': '青溪村口砸冰的汉子，手上全是冻口子',
         'origin': '生在村里，成亲后住在村西头。姐姐三年前嫁到山那头。',
         'now': '娘去年冬天没了，他走不开，口信捎不出去。',
         'want': '有人替他把那句话带到',
         'fear': '怕捎话的人把话编圆了',
         'voice': {'tone': '慢，每句前先擦手', 'catchphrase': '一字不差。'},
         'routine': [{'at': 'day', 'act': '在井台边砸冰，砸两下停一停'}],
         'arc': {'init': '他盯着自己的鞋说话。', 'warm': '话带到那天，他会把手擦干净了再跟你握手。'},
         'marks': ['擦手', '冻口子']},
        32),
    'act1_dianzhu': npc_base(
        'act1_dianzhu', '瘸腿店主', 'female', '山脚小店店主', 'shanjiao_inn', 'vendor',
        '左腿比右腿短一截，走路的时候肩先往左边沉一下，再迈步。说完话就去看灶，不看人的脸。',
        11,
        ['住一晚二十文，吃一顿十五文。', '陈家的？嫁过来那个？', '她男人去年没了。今年过年她一个人过。', '你要找她，明早去。她天不亮就上山捡柴。'],
        {'v': 1, 'tier': 'C', 'lock': False,
         'role': '华山道南边小店的女人，店里三间房，灶房的门卸下来靠在墙上',
         'origin': '山那边嫁过来，腿是小时候从坡上摔的。',
         'now': '一个人撑着店，记性好，谁家住哪儿她都知道。',
         'want': '冬天过去，柴别再湿',
         'fear': '怕夜里有人拍门',
         'voice': {'tone': '报价像报天气，不加字', 'catchphrase': '自己看。'},
         'routine': [{'at': 'day', 'act': '守着灶，汤锅里永远两块萝卜，一块先烂'}],
         'arc': {'init': '她不看你的脸。', 'warm': '她会多给你一块没烂的萝卜。'},
         'marks': ['瘸腿', '看灶']},
        38),
    'act1_ji': npc_base(
        'act1_ji', '计掌柜', 'male', '当铺掌柜', 'jn_pawnshop', 'vendor',
        '柜台比人高，他只站在柜台后面。指尖很干净，接过什么都先翻过来看封皮。',
        14,
        ['这个印，三年前的腊月按的。按的时候人还在。', '牢里没了。', '你想看单子，我把单子找给你。那单子七个月前就卖了。', '收废纸的。论斤。', '你留着吧。这个印现在没人认得了。再过两年，连我也认不得。'],
        {'v': 1, 'tier': 'C', 'lock': False,
         'role': '城东当铺的掌柜，柜台包了铜皮的边，磨得发亮',
         'origin': '从父辈手里接的铺子，木格里一半的纸比他年纪大。',
         'now': '七个月前把一批旧当票论斤卖给了收废纸的。',
         'want': '铺子里的格子别再空下去',
         'fear': '怕哪天有人拿着他认不得的东西进来',
         'voice': {'tone': '平，像念账', 'catchphrase': '论斤。'},
         'routine': [{'at': 'day', 'act': '坐在柜台后头，用两根手指头推东西'}],
         'arc': {'init': '他先看封皮，再看人。', 'warm': '他开始看人了，虽然还是不抬眼。'},
         'marks': ['看封皮', '死结腰带']},
        51),
}

# ---------- 40_npcs 落库（round-trip 保真，indent=1 无尾换行） ----------
d = json.load(open(P40, encoding='utf-8'))
n_added = 0
for k, v in NPCS.items():
    if k not in d['npcs']:
        d['npcs'][k] = v
        n_added += 1
assert not json.dumps(d, ensure_ascii=False, indent=1).endswith('\n')
open(P40, 'w', encoding='utf-8', newline='').write(json.dumps(d, ensure_ascii=False, indent=1))
print('40_npcs +%d 人' % n_added)

# ---------- 63_mainline_act1.json ----------
M63 = {
    '_note': '第一幕主线覆盖片（design/74 → design/88 施工单 P2）。剧情零 onEnter：全部 actions cond flag，玩家追踪才展开（扣着不讲）。',
    'rooms': {
        'road_jiangnan_1': {'actions': [
            {'label': '信', 'cmd': '问信', 'keywords': ['信', '那封信'],
             'desc': '老汉怀里那样东西是什么',
             'cond': {'flag': '挪过缸', 'notFlag': 'act1_letter_known'}, 'once': True,
             'failMsg': '缸还没挪开，老汉没空搭理这个。',
             'effects': [
                 {'type': 'narrate', 'raw': '他从怀里摸出一块粗布，布叠成四折，折痕的地方已经磨薄了。他把布摊在案上，布里包着一封信。'},
                 {'type': 'narrate', 'raw': '信没有拆过。封口的浆糊干透了，干得发脆，有一角已经翘起来。封皮上按着一个印，印是红的，颜色发暗，边上洇开的地方像小虫子。'},
                 {'type': 'narrate', 'raw': '「三年前腊月按的。」他说，「按的时候人还在。」'},
                 {'type': 'narrate', 'raw': '「华山。」他说，「山上有个姓令狐的。」'},
                 {'type': 'narrate', 'raw': '「我不认字。」他把信往你这边推了半寸，「我不认字，也不认得路。我这一辈子出过城南三次，最远的一次到过青溪村。」他说完把手在裤子上擦了两遍。「你识字么？」'},
                 {'type': 'flag', 'args': ['act1_letter_known']},
             ]},
            {'label': '接信', 'cmd': '接信', 'keywords': ['接信', '带信'],
             'desc': '把信带上',
             'cond': {'flag': 'act1_letter_known', 'notFlag': 'act1_letter_taken'}, 'once': True,
             'failMsg': '信还压在老汉的粗布里。',
             'effects': [
                 {'type': 'narrate', 'raw': '你把信收进怀里。布是粗的，信是轻的，轻得像没有东西。'},
                 {'type': 'flag', 'args': ['act1_letter_taken']},
             ]},
            {'label': '回话', 'cmd': '回茶摊', 'keywords': ['回话', '老汉', '告诉'],
             'desc': '当铺的事，说不说',
             'cond': {'flag': 'act1_pawn_done', 'notFlag': 'act1_choice_done'}, 'once': True,
             'failMsg': '当铺的事还没个结果。',
             'effects': [
                 {'type': 'narrate', 'raw': '你回到茶摊的时候，天已经偏西。老汉在擦碗，碗还是那只豁口的碗。他看见你，抬了一下下巴。「送到了？」'},
                 {'type': 'menu', 'raw': '把当铺掌柜的话学给他听，还是咽回去|告诉他>narrate:你把当铺掌柜的话学了一遍。说到「牢里没了」的时候，你停了一下。老汉擦完了那只碗，把它摞回原处，碗沿和碗沿对齐。「知道了。」他说。那天傍晚他给你添了三次水，三次都添到七分。;flag:act1_told_truth;flag:act1_choice_done;;不说>narrate:你把话咽回去了。「送到了。」你说。「哦。」他说。他给你添了水，添到七分停手。那天你们没再说别的。;flag:act1_kept_silent;flag:act1_choice_done'},
             ]},
        ]},
        'jn_pawnshop': {'actions': [
            {'label': '计掌柜', 'cmd': '给掌柜看信', 'keywords': ['掌柜', '看信', '计掌柜'],
             'desc': '把信递给柜台后面的人',
             'cond': {'flag': 'act1_letter_taken', 'notFlag': 'act1_pawn_done'}, 'once': True,
             'failMsg': '你怀里没有信。',
             'effects': [
                 {'type': 'narrate', 'raw': '他接过信，只把信翻过来，看封皮。指腹在封皮上蹭了一下。'},
                 {'type': 'narrate', 'raw': '「这个印，」他把信往柜台上一放，「三年前的腊月按的。按的时候人还在。」你问现在人呢。「牢里没了。」他说得很平。'},
                 {'type': 'narrate', 'raw': '「你想看单子，我把单子找给你。那单子七个月前就卖了。」你问他卖给谁了。「收废纸的。」他说，「论斤。」'},
                 {'type': 'narrate', 'raw': '他把信推回来。推的时候用两根手指，指尖很干净。「你留着吧。」他说，「这个印现在没人认得了。再过两年，连我也认不得。」'},
                 {'type': 'flag', 'args': ['act1_pawn_done']},
             ]},
        ]},
        'cunzhen_gate': {'actions': [
            {'label': '口信', 'cmd': '带口信', 'keywords': ['口信', '带话', '陈二'],
             'desc': '替他捎一句话',
             'cond': {'notFlag': 'act1_msg_carried'}, 'once': True,
             'failMsg': '话已经带上了。',
             'effects': [
                 {'type': 'narrate', 'raw': '「我姐嫁到山那头。三年了，没回来过，也没捎过信。」他把那句话说了两遍，两遍一字不差。说第二遍的时候他盯着自己的鞋看。'},
                 {'type': 'narrate', 'raw': '「你就说一句：娘去年冬天没了，埋在后坡，坟头朝东。」他顿了顿。「你要是忘了，就别编。编的比不说还坏。」'},
                 {'type': 'flag', 'args': ['act1_msg_carried']},
             ]},
        ]},
        'shanjiao_inn': {'actions': [
            {'label': '交口信', 'cmd': '转交口信', 'keywords': ['口信', '转交', '陈家'],
             'desc': '把那句话说到',
             'cond': {'flag': 'act1_msg_carried', 'notFlag': 'act1_msg_delivered'}, 'once': True,
             'failMsg': '你还没替陈二带话。',
             'effects': [
                 {'type': 'narrate', 'raw': '第二天一早你见到了她。她三十来岁，手上全是口子，深的那几道用布条缠着。你把话说了。一字不差。'},
                 {'type': 'narrate', 'raw': '她听完没有哭。她把手里的柴放下，放得很整齐，一根一根码在墙边。码完了她说：「知道了。」'},
                 {'type': 'narrate', 'raw': '她进屋，出来的时候手里拿着一样东西：一双鞋。鞋是新的，鞋底纳得很密，针脚一行一行，行距一样宽。「给我兄弟的。你路过的时候放下就成。别说是新做的，他不肯穿。」'},
                 {'type': 'narrate', 'raw': '你得到一双布鞋。旧物，不可出售。鞋底纳得很密，针脚行距一样宽。'},
                 {'type': 'flag', 'args': ['act1_msg_delivered']},
             ]},
        ]},
        'huashan_siguoya': {'actions': [
            {'label': '石壁', 'cmd': '认痕', 'keywords': ['石壁', '剑痕', '认'],
             'desc': '在壁前待一夜，认出本门前辈那一道',
             'cond': {'flag': 'act1_letter_taken', 'notFlag': 'act1_recognized'}, 'once': True,
             'failMsg': '山下的事没了结，你坐不下来。',
             'effects': [
                 {'type': 'narrate', 'raw': '崖上有面石壁，壁上有二十七道剑痕。你在壁前坐下。夜里的风从崖底往上灌，灌得灯火伏下去又立起来。'},
                 {'type': 'narrate', 'raw': '天蒙蒙亮的时候你看出来了。第二十一道。别的那二十六道都是砸进石头里的，只有这一道是收着劲收尾的，痕尾往上挑了半分。砸进去容易，收住难。'},
                 {'type': 'narrate', 'raw': '「第一夜就认出来了。」值守的弟子举着那盏烧出洞的灯，看了看你，「山上见。」'},
                 {'type': 'flag', 'args': ['act1_recognized']},
             ]},
        ]},
    },
}
if not os.path.exists(P63):
    from _canon_write import write_canon; write_canon(P63, M63)
    print('63_mainline_act1.json 新建：6 房 8 组剧情 actions，全部 cond flag 追踪式')
else:
    print('63 已存在，跳过')
