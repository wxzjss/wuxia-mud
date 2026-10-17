#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_label_fix.py —— label/cmd 落空最后 16 条（数据侧）
----------------------------------------------------------------
背景：引擎侧 label→cmd 兜底已落（落空 92→16）。剩 16 条按两类修：
 ① 动作存在但 effects 空（点了/敲了只得到 B6 兜底句）→ 补 narrate（有一句算一句）；
 ② 动作挂的是内置 NPC 指令、但 NPC 是「懒生成实例」→ 加 effects 让房动作自己说话，
    或删掉空动作把内置指令让回去（`list 林守拙` 有 shop_book，删掉即恢复买卖）。

⚠️ 挂房纪律：`jn_bookshop / jn_harbor / jn_fortune / jn_yamen_court / jn_school`
   由 62_shops.json 覆盖（最后定义且带 actions）→ 一律写 62；其余写 50_map。
⚠️ 不是「只补 desc」：B6 不拿 desc 拼句子，必须给 effects。
幂等：结构比对，两连跑 OK。writer 走 tools/_canon_write.py（按基线格式落盘）。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}

# =====================================================================
# ① 补 effects（房间 → cmd → effects）
# =====================================================================
FILL = [
  ('50_map.json', 'jn_rich_house', 'knock 钱府', [
     narr('门环是铜的，敲三下，声音闷在门里。里头有脚步近了两步，又停住。')]),
  ('50_map.json', 'jn_yamen_gate', 'read 告示', [
     narr('告示是新贴的，浆糊没干透。上头画着一个人的脸，画得不像，底下的字倒写得清楚：拿获者赏。')]),
  ('50_map.json', 'jn_yamen_gate', 'knock 登闻鼓', [
     narr('鼓面蒙的是牛皮，敲一下，声音撞在门房里出不去。守门的人抬了抬眼皮，没动。')]),
  ('50_map.json', 'jn_school_lib', 'search 书架', [
     narr('靠里那格被人动过，书脊朝里摆，书名看不见。抽出一本，是一册账。')]),
  ('50_map.json', 'cunzhen_pond', 'fish', [
     narr('水面平，浮子一动不动。芦苇里响了一下，又静了。')]),
  ('50_map.json', 'jn_woods_1', 'gather', [
     narr('松针踩上去软。树根底下有几丛蘑菇，一半被虫啃过。')]),
  ('50_map.json', 'jn_stream', 'fish', [
     narr('溪水凉，手伸进去，指头立刻发麻。')]),
  ('50_map.json', 'jn_cave', 'read 石壁', [
     narr('石壁上的字刻得浅，得斜着看。三个字，末一个刻坏了，认不出。')]),
  # —— 62 覆盖的五个房 ——
  ('62_shops.json', 'jn_harbor', 'drink', [
     narr('江水浑，捧起来能看见细沙打旋。喝一口，泥味压过凉味。')]),
  ('62_shops.json', 'jn_harbor', 'ask 王大壮 about 搬运', [
     narr('跳板被踩得发亮，中间凹下去一块。'),
     say('王大壮把扁担换个肩：「要搬什么？按斤算钱。」')]),
  ('62_shops.json', 'jn_fortune', 'ask 徐半仙 about 算命', [
     narr('卦摊上摆着六枚铜钱，一枚缺了角。'),
     say('徐半仙捻着胡子：「客官面有风尘色，是刚赶了远路。」')]),
  ('62_shops.json', 'jn_yamen_court', 'talk 元怀瑾', [
     narr('案上摊着两本卷宗，一本压着另一本。'),
     say('元怀瑾没有抬头：「本官事忙，有话快说。」')]),
  ('62_shops.json', 'jn_yamen_court', 'talk 县太爷', [
     narr('公案后那把太师椅的扶手，被摸得比别处亮。'),
     say('县太爷把惊堂木挪开半寸：「民状呈上来，本县自会看。」')]),
  ('62_shops.json', 'jn_school', 'ask 陆见山 about 学问', [
     narr('讲堂的窗纸新糊过，边角还翘着。'),
     say('陆见山放下书：「读书不为功名，为的是心里那杆秤。」')]),
]

# ② 50_map 里被 62 覆盖的两颗（要补到 62 才有用）
ADD_62 = [
  ('jn_bookshop', {"cmd": "翻词本", "label": "翻架上的词本", "keywords": ["词本", "翻书", "词"],
     "effects": [narr('架上的词本翻到一半，夹着一张当票。词是旧的，当票是新的。')]}),
  ('jn_harbor', {"cmd": "看船期牌", "label": "看码头上挂的船期牌", "keywords": ["船期牌", "船期", "开船"],
     "effects": [narr('牌上写着开船的时辰，雨水泡糊了两行，只剩「辰时」「午时」还看得清。')]}),
]

# ③ 删掉空动作、把内置指令让回去（有 shop 的 list）
DELETE = [
  ('62_shops.json', 'jn_bookshop', 'list 林守拙'),   # 林守拙 shop=shop_book，删掉即恢复买卖
]

dirty = set()
docs = {}
def doc(fn):
    if fn not in docs:
        docs[fn] = read(fn)
    return docs[fn]

for fn, rid, cmd, fx in FILL:
    acts = doc(fn)['rooms'][rid].setdefault('actions', [])
    hit = next((a for a in acts if a.get('cmd') == cmd), None)
    if hit is None:
        continue
    if hit.get('effects'):
        continue                      # 已有内容，不覆盖
    hit['effects'] = fx
    dirty.add(fn)

for rid, want in ADD_62:
    acts = doc('62_shops.json')['rooms'][rid].setdefault('actions', [])
    hit = next((a for a in acts if a.get('cmd') == want['cmd']), None)
    if hit is None:
        acts.append(want); dirty.add('62_shops.json')
    elif not hit.get('effects'):
        hit['effects'] = want['effects']; dirty.add('62_shops.json')

for fn, rid, cmd in DELETE:
    acts = doc(fn)['rooms'][rid].get('actions') or []
    keep = [a for a in acts if a.get('cmd') != cmd]
    if len(keep) != len(acts):
        doc(fn)['rooms'][rid]['actions'] = keep
        dirty.add(fn)

for fn in sorted(dirty):
    write_canon(os.path.join(DATA, fn), docs[fn])
print('改动分片:', sorted(dirty) or '（无）')

# =====================================================================
# 断言
# =====================================================================
v50, v62 = read('50_map.json'), read('62_shops.json')
for fn, rid, cmd, fx in FILL:
    v = v50 if fn == '50_map.json' else v62
    a = next((x for x in v['rooms'][rid]['actions'] if x.get('cmd') == cmd), None)
    assert a and a.get('effects') == fx, f'{rid}·{cmd} 效果未落'

for rid, want in ADD_62:
    a = next((x for x in v62['rooms'][rid]['actions'] if x.get('cmd') == want['cmd']), None)
    assert a and a.get('effects'), f'{rid}·{want["cmd"]} 未补'

a = next((x for x in v62['rooms']['jn_bookshop']['actions'] if x.get('cmd') == 'list 林守拙'), None)
assert a is None, 'list 林守拙 空动作未删（会挡住内置买卖）'

# effects 不许是空串 / 不许只 desc
for fn, rid, cmd, fx in FILL:
    v = v50 if fn == '50_map.json' else v62
    a = next(x for x in v['rooms'][rid]['actions'] if x.get('cmd') == cmd)
    assert all((e.get('raw') or '').strip() for e in a['effects']), f'{rid}·{cmd} 有空句'

print('断言全过：13 处补 effects（含 62 覆盖的 5 处）+ 2 处补到 62 的新颗 + 1 处删死键')
