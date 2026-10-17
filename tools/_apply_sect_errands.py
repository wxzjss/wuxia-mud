#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sect_errands.py —— 114-② 35 派各补一条门派差事
----------------------------------------------------------------
据 `tools/_out_sect_gap.tsv`：35 派无 `type=门派` 任务。每派一条，S3 简化两段
（做事 → 回山门复命），统一奖励 `+contrib 本门 30 / +exp 180 / +pot 60 / 掌门一句`。
三类差事按门派生计分：护山（kill）/ 巡山整理（room）/ 采办（item）。

挂接：quests 写进 `67_sidequests2.json`（canonical LF）；同时把 quest id 追加到
对应掌门 NPC 的 `quests` 数组（29 派掌门在 73_sects_place；摩教/星宿/血刀/侠客岛在 40_npcs），
否则玩家在掌门那里看不到这条事。
幂等：按 id 存在即跳过；两连跑第二遍「新增 0」。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

# sect: (giver, 类型, 目标, stage0 文案, 掌门一句)
E = {
  # ── 护山 / 试手（kill）──
  'jindao':   ('jindao_master',   'kill', {'keys': ['mob_bandit'], 'count': 3},
               '山下的散匪摸到金刀门外的道上，把他们赶回去', '金世安：「刀口别卷。回去上油。」'),
  'wuhu':     ('wuhu_master',     'kill', {'keys': ['mob_bandit', 'mob_bandit_chief'], 'count': 3},
               '官道上有伙人专劫单行的商客，去清一趟', '雷五虎：「五个人守五条道。你守哪条，自己挑。」'),
  'kuaidao':  ('kuaidao_master',  'kill', {'keys': ['mob_assassin'], 'count': 2},
               '有人夜里摸到快刀门外探路，把人留下', '单冲：「刀快不算本事。收得住才算。」'),
  'baisheng': ('baisheng_master', 'kill', {'keys': ['mob_soldier'], 'count': 3},
               '巡城的兵丁近来总在门口转，打发他们走', '常百胜：「别砍死。砍死了要赔。」'),
  'tieqiang': ('tieqiang_master', 'kill', {'keys': ['mob_boar'], 'count': 3},
               '后山的野猪拱了菜地，挑死几头', '岳擎：「枪要平。抖一下就是三寸。」'),
  'tiezhang': ('tiezhang_master', 'kill', {'keys': ['mob_black_bear', 'mob_wolf'], 'count': 3},
               '山道上的熊和狼伤了樵夫，去除了', '裴镇山：「掌下去要有一声闷响。」'),
  'shenquan': ('shenquan_master', 'kill', {'keys': ['mob_boar'], 'count': 2},
               '村后的野猪进了院，打死了拖回来', '武连山：「打完洗手。拳上带腥气不好看。」'),
  'luohan':   ('luohan_master',   'kill', {'keys': ['mob_wolf'], 'count': 3},
               '庙后的狼群夜里叫，扰了早课', '空悟：「打狼不打窝。窝里有崽。」'),
  'xuedao':   ('blood_saber',     'kill', {'keys': ['mob_soldier'], 'count': 3},
               '巡边的兵丁近前庭了，让他们留下', '血刀老祖：「刀口舔过血，才算入门。」'),
  'mojiao':   ('mojiao_dongfang', 'kill', {'keys': ['mob_soldier'], 'count': 3},
               '崖下巡哨的人换了班，把这一班留下', '东方不败：「不必留活口。留一个报信的就够。」'),
  # ── 巡山 / 整理（room）──
  'taishan':   ('taishan_master',   'room', {'key': 'taishan_hall'},
                '把山门到正殿的石阶扫一遍，霜下来打滑', '卜守正：「石阶扫干净。上山的人先看这个。」'),
  'hengshan':  ('hengshan_master',  'room', {'key': 'hengshan_hall'},
                '剑坪的落叶扫到东头，西头又落满', '莫听松：「扫不过来就慢慢扫。」'),
  'hengshanN': ('hengshanN_master', 'room', {'key': 'hengshanN_hall'},
                '后殿的灯油添一遍，别让灯断在半夜', '静玄师太：「灯要长明。人也是。」'),
  'qingcheng': ('qingcheng_master', 'room', {'key': 'qingcheng_hall'},
                '雾天沿着崖边巡一圈，看栏杆松没松', '余松亭：「雾里走路，脚比眼可靠。」'),
  'kongtong':  ('kongtong_master',  'room', {'key': 'kongtong_hall'},
                '演武场的兵器散着，归位', '关铁衣：「兵器归位，心也归位。」'),
  'kunlun':    ('kunlun_master',    'room', {'key': 'kunlun_hall'},
                '风口那面旗撕了半边，换一面新的', '霍长风：「昆仑的旗不能倒着挂。」'),
  'diancang':  ('diancang_master',  'room', {'key': 'diancang_hall'},
                '把院里的石子捡出来，练眼要用', '段明川：「石子要圆的。棱角的会伤人。」'),
  'wuliang':   ('wuliang_master',   'room', {'key': 'wuliang_hall'},
                '剑架上的剑擦一遍，别留手印', '段青崖：「剑上有手印，出鞘就慢半分。」'),
  'hehuan':    ('hehuan_master',    'room', {'key': 'hehuan_hall'},
                '帘子晒褪色了，换一幅', '柳含烟：「帘子要新的。人也是。」'),
  'wuyun':     ('wuyun_master',     'room', {'key': 'wuyun_hall'},
                '院里的柴码齐，别靠着墙', '温世昌：「柴离墙三寸，潮气上不来。」'),
  'dafeng':    ('dafeng_master',    'room', {'key': 'dafeng_hall'},
                '门口的土扫开，风一起就糊门', '燕双飞：「风来了挡不住。土能扫。」'),
  'funiu':     ('funiu_master',     'room', {'key': 'funiu_hall'},
                '牛棚的草添满，夜里冷', '牛伯耕：「牛吃好了，人才有得吃。」'),
  'baituo':    ('baituo_master',    'room', {'key': 'baituo_hall'},
                '把毡子搬出去晒，山里的潮气重', '欧阳夜：「毡子潮了，刀会锈。」'),
  'huanghe':   ('huanghe_master',   'room', {'key': 'huanghe_hall'},
                '跳板上结了霜，刮干净', '沙万舟：「跳板滑一下，货就下水了。」'),
  'taihu':     ('taihu_master',     'room', {'key': 'taihu_hall'},
                '补三张网，明早出湖要用', '陆子清：「网眼补密些。小鱼放回去。」'),
  'poyang':    ('poyang_master',    'room', {'key': 'poyang_hall'},
                '旗子降下来收好，夜里风大', '鄱九：「旗倒了不吉利。收起来。」'),
  'qingzhu':   ('qingzhu_master',   'room', {'key': 'qingzhu_hall'},
                '削一捆竹签，明早要用', '祝青竹：「签子削尖了，手别抖。」'),
  'jujing':    ('jujing_master',    'room', {'key': 'jujing_hall'},
                '舱里进了水，舀干', '海九皋：「水舀不干，船就沉。舀。」'),
  'jinlong':   ('jinlong_master',   'room', {'key': 'jinlong_hall'},
                '门槛的油擦匀，别糊了来客的鞋', '龙在渊：「门槛是脸面。糊人一脚，记一辈子。」'),
  'feihu':     ('feihu_master',     'room', {'key': 'feihu_hall'},
                '镖车上的绳重新捆一遍', '秦伯远：「绳松一寸，路上丢一箱。」'),
  'zhenyuan':  ('zhenyuan_master',  'room', {'key': 'zhenyuan_hall'},
                '镖旗卷好入库，别让雨泡了', '周慎行：「旗在人在。旗不在，镖也不算到。」'),
  # ── 采办（item）──
  'tangmen':  ('tangmen_master', 'item', {'key': 'herb_lingshen', 'count': 1},
               '药圃缺一味引子，去山下采一支灵芝', '唐不语：「采的时候戴手套。它认得人手。」'),
  'gumu':     ('gumu_master',    'item', {'key': 'herb_hanshui', 'count': 2},
               '蜂箱要换新草，后山采两把寒水草', '甄清黎：「草要带露采。干了就没用。」'),
  'xingxiu':  ('xingxiu_laoxian', 'item', {'key': 'herb_xuecao', 'count': 2},
               '练功要用的血草断了，去采两把', '丁春秋：「采回来先给我看。你分不出真假。」'),
  'xiake':    ('npcv_080',       'item', {'key': 'iron_ore', 'count': 2},
               '渡口的船要补钉，去捡两块铁矿石', '鲍归：「岛上没有铁匠。石头也得自己捡。」'),
}

SECTS = {}
for fn in ('30_sects.json', '72_sects_tier.json', '74_martial_sects.json', '84_hehuan.json'):
    for k, v in (read(fn).get('sects') or {}).items():
        SECTS.setdefault(k, {}).update(v)

d67 = read('67_sidequests2.json')
qs = d67.setdefault('quests', {})
added = []

def target_of(t):
    if t['keys'] if 'keys' in t else False:
        return {"id": "slay", "kind": "kill", "keys": t['keys'], "desc": "", "count": t['count']}
    if 'key' in t and isinstance(t['key'], str) and t.get('_item'):
        return None
    return None

for sect, (giver, kind, tgt, desc0, sayline) in E.items():
    qid = 'q_sect_%s_errand' % sect
    if qid in qs:
        continue
    if kind == 'kill':
        t0 = {"id": "slay", "kind": "kill", "keys": tgt['keys'], "desc": desc0, "count": tgt['count']}
        var = None
    elif kind == 'room':
        t0 = {"id": "go", "kind": "room", "key": tgt['key'], "desc": desc0, "count": 1,
              "var": qid + "_go"}
        var = qid + "_go"
    else:
        t0 = {"id": "fetch", "kind": "item", "key": tgt['key'], "desc": desc0, "count": tgt['count']}
        var = None
    st0 = {"desc": desc0, "targets": [t0], "next": 1}
    if var:
        st0["cond"] = {"var": var}
    qs[qid] = {
        "id": qid, "name": SECTS.get(sect, {}).get('name', sect) + '的差事',
        "type": "门派", "level": 12, "giver": giver,
        "desc": desc0 + "。",
        "require": {"sect": sect},
        "stages": [st0, {"desc": "回山门复命", "next": 99}],
        "rewards": [
            {"type": "+contrib", "args": ["本门", 30]},
            {"type": "+exp", "args": [180]},
            {"type": "+pot", "args": [60]},
            {"type": "say", "raw": sayline},
        ],
    }
    added.append((sect, qid, giver))

print('新增门派差事：%d 条' % len(added))
if added:
    write_canon(os.path.join(DATA, '67_sidequests2.json'), d67)

# 挂到掌门 NPC 的 quests 列表
# ⚠️ merge 语义：数组按「后位分片整段替换」。所以必须挂到**最后一个定义了该 NPC quests 的分片**，
# 否则会被后面的分片（如 65_mainline_act3 给 mojiao_dongfang 的 ["q_main_moye"]）顶掉。
FILES2 = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
DOCS2 = {fn: read(fn) for fn in FILES2}
hooked = 0
touched = set()
for sect, (giver, _k, _t, _d, _s) in E.items():
    qid = 'q_sect_%s_errand' % sect
    target_fn, target_n = None, None
    for fn in FILES2:
        d = DOCS2[fn]
        n = (d.get('npcs') or {}).get(giver)
        if not isinstance(n, dict):
            continue
        if isinstance(n.get('quests'), list):
            target_fn, target_n = fn, n
        elif target_fn is None:
            target_fn, target_n = fn, n
    if not target_fn:
        print('⚠️ 找不到 giver 定义:', giver)
        continue
    ql = target_n.get('quests') if isinstance(target_n.get('quests'), list) else []
    if qid not in ql:
        ql.append(qid)
        target_n['quests'] = ql
        hooked += 1
    touched.add(target_fn)
for fn in sorted(touched):
    write_canon(os.path.join(DATA, fn), DOCS2[fn])
print('挂到掌门：%d 处（分片 %d 个）' % (hooked, len(touched)))

# ---------------- 断言 ----------------
v = read('67_sidequests2.json')['quests']
for sect, (giver, kind, tgt, desc0, sayline) in E.items():
    qid = 'q_sect_%s_errand' % sect
    assert qid in v, qid + ' 未落'
    q = v[qid]
    assert q['require'] == {"sect": sect}, qid + ' require 不对'
    assert len(q['stages']) == 2, qid + ' 段数不对'
    assert any(e.get('type') == '+contrib' and e['args'] == ['本门', 30] for e in q['rewards']), qid + ' 缺 contrib'
    assert any(e.get('type') == 'say' for e in q['rewards']), qid + ' 缺台词'
    assert q['stages'][-1]['next'] == 99, qid + ' 收束不对'
print('断言全过：%d 条差事结构完整（require.sect / 两段 / contrib30 / 台词 / 99）' % len(E))
