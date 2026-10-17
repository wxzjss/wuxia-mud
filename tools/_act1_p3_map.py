#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""act1 P3 落库 · 第 1 批：50_map 挪缸 T-A 五步状态机（design/91 §三，74 原文入 narrate）
幂等：重跑检测到新 flag 即跳过。"""
import json, sys

P = 'game/data/50_map.json'
d = json.loads(open(P, encoding='utf8').read())
room = d['rooms']['road_jiangnan_1']
acts = room['actions']

if any(a.get('cmd') == '伸手' for a in acts):
    print('已落库（幂等跳过）'); sys.exit(0)

# 1) 退役旧三步雏形（挪缸/舀水/掏灰 旧 flag 版）
acts[:] = [a for a in acts if a.get('cmd') not in ('挪缸', '舀水', '掏灰')]

def narrate(t): return {"type": "narrate", "raw": t}
def flag(f): return {"type": "flag", "args": [f]}

new_acts = [
    {   # 瓢：②倒水的容器（74：案底下摸出一只木瓢）
        "label": "翻案底", "cmd": "翻案底", "keywords": ["翻案底", "案底", "木瓢"],
        "desc": "茶摊的案子底下堆着些杂物。",
        "cond": {"notFlag": "act1_piao_taken"}, "once": True,
        "failMsg": "案底下翻过了，没别的了。",
        "effects": [
            narrate("你蹲下去翻案底。箩筐、破草鞋、半捆干稻草。最里头有一只木瓢，瓢把上裂了道缝，缝里塞着一小块布。"),
            narrate("你把布抠出来，布是干的。瓢尚且能用。"),
            {"type": "+item", "args": ["mu_piao", 1]},
            flag("act1_piao_taken"),
        ],
    },
    {   # ①伸手（74 成功文本；失败分支不落数值——team-lead 批）
        "label": "伸手", "cmd": "伸手", "keywords": ["伸手", "摸缸", "探缸"],
        "desc": "缸身那道旧裂纹朝外，正对你。",
        "cond": {"notFlag": "act1_vat_look"},
        "failMsg": "你已把缸底摸清了。",
        "effects": [
            narrate("你蹲下去，把手掌贴着缸沿底下往里插。指腹先碰到一层滑腻的东西，是青苔，长在缸脚背阴的那一面。"),
            narrate("再往里，指头碰到湿泥。泥是软的，缸陷在泥里约莫一寸。"),
            narrate("你把手抽出来，手背上沾了一道绿。"),
            flag("act1_vat_look"),
        ],
    },
    {   # ②倒水（需瓢；无瓢走 failMsg＝74 失败文本）
        "label": "倒水", "cmd": "倒水", "keywords": ["倒水", "舀水"],
        "desc": "缸里的水澄了半缸泥。",
        "cond": {"flag": "act1_vat_look", "notFlag": "act1_vat_pour", "item": "mu_piao"},
        "failMsg": "你用喝茶那只碗舀。舀了七碗，水面下去不到一指。第八碗你没端住，碗磕在缸沿上，豁口那边又崩掉一小片，崩下来的瓷碴掉进水里，转了两圈沉了。你的手先酸了。",
        "effects": [
            narrate("你从案底下摸出那只木瓢，瓢把上裂了道缝，缝里塞着一小块布。"),
            narrate("你舀了十几下，水面下去一半。地上一片湿，湿到灶膛口，湿土的颜色变深，踩上去有点粘鞋。"),
            narrate("缸轻了。"),
            narrate("缸变滑了。你第二次伸手的时候，手掌在缸壁上打了个滑。"),
            flag("act1_vat_pour"),
        ],
    },
    {   # ③撬（没倒水就撬＝74 失败文本，裂纹不可逆由文本承担）
        "label": "撬", "cmd": "撬", "keywords": ["撬", "撬缸", "扁担"],
        "desc": "柴堆边上竖着一根扁担，两头包着铁，锈得厉害。",
        "cond": {"flag": "act1_vat_pour", "notFlag": "act1_vat_pry"},
        "failMsg": "你把扁担插进缝里，压下去。缸歪了一下。你听见裂纹张开的声音，那声音很短，像指甲刮过窗纸，刮一下就没了。「松手！」老汉在那头喊了一声。你松了手。缸坐回泥里，砸出一个坑，坑里立刻渗出水。缸身那道裂纹比原来长了一寸。这一步可以重来。但裂纹不会再合上。",
        "effects": [
            narrate("你把扁担抽出来。扁担两头包着铁，铁锈得厉害，一捏就掉渣。"),
            narrate("你把扁担插进缸底与地的缝里，一点一点往下压。"),
            narrate("缸离地半寸。泥发出一声闷响，声音是从地底下出来的，不是从缸上。"),
            flag("act1_vat_pry"),
        ],
    },
    {   # ④垫（木板场景内置）
        "label": "垫", "cmd": "垫", "keywords": ["垫", "垫木板", "木板"],
        "desc": "柴堆底下压着一块木板，一半埋在雪里。",
        "cond": {"flag": "act1_vat_pry", "notFlag": "act1_vat_wedge"},
        "failMsg": "缸底还没撬起来，垫不进去。",
        "effects": [
            narrate("你从柴堆里抽出一块木板。板是湿的，一半埋在雪里，另一半冻硬了。"),
            narrate("你把板塞进缸底。板进去的时候吱了一声，是湿木头压在湿泥上的声音。"),
            narrate("老汉伸手在板上按了按：「这块行。」"),
            flag("act1_vat_wedge"),
        ],
    },
    {   # ⑤挪缸（终点）
        "label": "挪缸", "cmd": "挪缸", "keywords": ["挪缸", "挪", "推缸"],
        "desc": "缸就位了，就差最后一下。",
        "cond": {"flag": "act1_vat_pry", "notFlag": "act1_vat_moved"},
        "failMsg": "你两手扣住缸沿，腰上使了劲。缸挪了半尺，就再也推不动。你松了手，坐在地上喘。手指头在抖，抖得拿不住东西。老汉说：「歇。歇够了再来。」",
        "effects": [
            narrate("你两手扣住缸沿，脚往后蹬，腰上使了劲。"),
            narrate("缸动了。缸底那块木板跟着往前走，压出一道浅槽，槽里挤出来的泥堆在两边。"),
            narrate("你把它挪了三尺。"),
            narrate("缸离墙三尺。墙根留下一片湿印，湿印的边缘比中间深。"),
            flag("act1_vat_moved"),
        ],
    },
    {   # 做完之后（掏灰＋β 奖励，74「做完之后」段；once 领奖）
        "label": "掏灰", "cmd": "掏灰", "keywords": ["掏灰", "掏灶膛"],
        "desc": "灰坑在灶后头。",
        "cond": {"flag": "act1_vat_moved", "notFlag": "act1_fist_taught"},
        "once": True,
        "failMsg": "老汉已经掏完灰了。",
        "effects": [
            narrate("老汉侧着身子从缸和灶之间过去了。他过去得很顺，肩膀没碰到缸。"),
            narrate("他掏完灰，站直了，拍了拍手上的土。"),
            narrate("他看了缸一眼，又看了你一眼。"),
            narrate("他这才从怀里摸出一样东西。"),
            narrate("「你有力气。」他说，「力气不该白长着。我教你三手，防身用的，不好看，但摔不倒。」"),
            {"type": "learnskill", "args": ["jh_fist"]},
            {"type": "+skill", "args": ["jh_fist", 10]},
            narrate("他把一把猎刀塞进你手里。刀鞘是旧的，磨得发亮。「路上不干净。」他说。"),
            {"type": "+item", "args": ["hunting_knife", 1]},
            flag("act1_fist_taught"),
        ],
    },
]
acts.extend(new_acts)

# 2) 信链换旗：问信 cond 挪过缸 → act1_vat_moved（旧 flag 退役）
for a in acts:
    c = a.get('cond') or {}
    if c.get('flag') == '挪过缸':
        c['flag'] = 'act1_vat_moved'

from _canon_write import write_canon
write_canon(P, d)
print('50_map 五步落库：', [a['cmd'] for a in acts])
