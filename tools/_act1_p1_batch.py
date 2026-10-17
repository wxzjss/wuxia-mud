# -*- coding: utf-8 -*-
"""act1 P1 批量：南门/当铺 desc、独木桥+山脚小店新建、T-C 三步、路钱 action、exits 对称接线。"""
import json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '50_map.json')
d = json.load(open(P, encoding='utf-8'))
r = d['rooms']

# 1) desc 改写
r['jiangnan_gate']['desc'] = (
    '城门洞里比外头暖。墙上贴着几张告示，最上面那张让人撕掉一半，撕口是斜的，'
    '剩下半张上只有一个「缉」字和半个「访」字。门洞底下有一道石槽，槽里积着土和干草，'
    '是拉车的牲口踩出来的。出城的人排着队，队前坐着个收钱的，不穿号衣，'
    '棉袄袖口油得发亮，膝盖上搁一只粗瓷碗，碗里有小半碗铜钱。'
    '他手边压着一块木牌，牌上写着「肃政缉访司」五个字，木茬还白。')
r['jn_pawnshop']['desc'] = (
    '高高的柜台包着一道铜皮边，磨得发亮，亮的正是人肘子搁的那一截。'
    '柜台后头是个戴眼镜的二掌柜，墙上写着一个大大的「當」字。这里什么都收，也什么都卖。')

# 2) 新房
r['dumuqiao'] = {
    'id': 'dumuqiao', 'name': '荒野·独木桥', 'region': 'cunzhen',
    'desc': ('涧上的独木桥是一根杉木搭的，皮没剥干净，皮上有几处鼓起来，鼓的地方是空的。'
             '桥面朝北那半边长着青苔，湿得发亮。涧里的水声比人声响，'
             '水声响的地方看不见水，只有一片黑。桥头土上有一道旧车辙，辙里积着雪水。'),
    'exits': {'se': 'cunzhen_gate', 'n': 'shanjiao_inn'},
    'actions': [
        {'label': '桥', 'cmd': '探桥', 'keywords': ['探', '桥', '杉木'],
         'desc': '先用脚试试桥头的虚实',
         'cond': {'notFlag': 'act1_bridge_probe'}, 'once': True,
         'failMsg': '',
         'effects': [
             {'type': 'narrate', 'raw': '你先用脚在桥头试了试。杉木是湿的，湿的地方颜色发暗。'},
             {'type': 'narrate', 'raw': '你踩了三下。第一下是空的，第二下闷，第三下你听出底下是实的。'},
             {'type': 'flag', 'args': ['act1_bridge_probe']},
         ]},
        {'label': '稳脚', 'cmd': '稳脚', 'keywords': ['稳', '蹭鞋'],
         'desc': '把鞋底在干土上蹭干净',
         'cond': {'flag': 'act1_bridge_probe', 'notFlag': 'act1_bridge_steady'}, 'once': True,
         'failMsg': '桥还没探过，你不知道哪儿实哪儿空。',
         'effects': [
             {'type': 'narrate', 'raw': '你蹲下来，把鞋底在干土上蹭。蹭了七八下，蹭下来的泥掉在桥头，掉成一个小堆。'},
             {'type': 'narrate', 'raw': '你站起来的时候看着桥的那一头，没看脚下。走这种桥的人，看脚下多半过不去。'},
             {'type': 'flag', 'args': ['act1_bridge_steady']},
         ]},
        {'label': '过桥', 'cmd': '过桥', 'keywords': ['过', '过桥'],
         'desc': '过了这道涧，北边就是华山地界',
         'cond': {'flag': 'act1_bridge_steady', 'notFlag': 'act1_bridge_crossed'}, 'once': True,
         'failMsg': '桥还没稳住脚。青苔湿着，你现在过去，多半要交代在涧里。',
         'effects': [
             {'type': 'narrate', 'raw': '你走过去了。走到中间的时候桥往下弯了一点，弯的时候木头响了一声，声音很闷，像有人在底下咳嗽。'},
             {'type': 'narrate', 'raw': '你没停。停下来比走下去难。脚跟落地的时候你顺势蹲了一下，手撑到的土是干的。'},
             {'type': 'flag', 'args': ['act1_bridge_crossed']},
         ]},
    ],
}
r['shanjiao_inn'] = {
    'id': 'shanjiao_inn', 'name': '华山道·山脚小店', 'region': 'huashan',
    'desc': ('小店三间房，一间住人，一间堆柴，一间是灶房。灶房的门卸了下来，斜靠在墙上。'
             '烟囱冒着一点细烟，风一过就散。门口立着一条扁担，担钩锈成褐色。'
             '墙根码着一垛柴，一行比一行缩进去，像座塔。'),
    'exits': {'s': 'dumuqiao', 'n': 'road_huashan_1'},
    'actions': [],
}

# 3) exits 对称接线
assert 'nw' not in r['cunzhen_gate']['exits']
r['cunzhen_gate']['exits']['nw'] = 'dumuqiao'
r['road_huashan_1']['exits']['s'] = 'shanjiao_inn'

# 4) 南门路钱 action
r['jiangnan_gate'].setdefault('actions', []).append({
    'label': '路钱', 'cmd': '交路钱', 'keywords': ['路钱', '交钱', '出城'],
    'desc': '出城一人十文',
    'cond': {'money': '>=10'},
    'failMsg': '碗里的铜钱你数得出数。你的钱袋不行。',
    'effects': [
        {'type': 'narrate', 'raw': '你给了十文。铜钱丢进碗里，在碗底转了一圈才停。'},
        {'type': 'narrate', 'raw': '「回来还要十文。」他说，「回来的时候我在城墙根底下坐，不在门洞里。」'},
        {'type': '-money', 'args': [10]},
        {'type': 'flag', 'args': ['act1_toll_paid']},
    ],
})

from _canon_write import write_canon
write_canon(P, d)
print('P1 批量落库：desc 改 2 + 新房 2 + exits 接线 4 处 + actions 4 组（路钱 + T-C 三步）')
