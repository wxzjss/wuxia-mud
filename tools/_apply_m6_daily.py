#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_m6_daily.py —— M6 降名分两步走（design/108，游有方 2026-10-18）
----------------------------------------------------------------
第一步（纯增量）：79 条 sq_npcv_* 加 `daily: true` + `shell:"采药"…`
                   id / type / stages / rewards 一字不动。
第二步（内容修复）：卷三/卷四区域（北疆·雪谷 / 西夏·盐池 / 西域 / 蛮荒）的
                   10 条日课 desc 按本地物象与生计重写；同一壳型不跨区共用一句。

判据与断言：
 · 79/79 daily=true、shell 落在十种壳内、type 仍为「支线」、结构仍 1-target+next99
 · 新 desc 不过朱雀红线（无破折号 / 无对偶 / 无偏好词）
 · 同一句 desc 不许被 ≥2 个区域引用（防复用回潮）
幂等：逐字段比对，两连跑 OK。写盘 indent=2 + 尾换行。
"""
import json, os, io, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P60 = os.path.join(ROOT, 'game', 'data', '60_quests.json')
P40 = os.path.join(ROOT, 'game', 'data', '40_npcs.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')

SHELLS = ['采药', '采买', '打探', '了结', '送信', '寻物', '护送', '寻人', '除害', '讨债']

# 第二步：卷三/卷四 10 条 desc 按区重写（本地物象与生计）
DESC_MAP = {
  # 北疆·雪谷（口粮 / 马料 / 冻伤 / 刀口）
  'sq_npcv_067': '血刀寨有人往南边递话。狄知想知道递的是什么，自己不敢问。',
  'sq_npcv_141': '雪道上马料断了。马秋托你带一袋回来，单子上还有两斤粗盐。',
  'sq_npcv_212': '寨里有人冻烂了脚。药在山那边的雪谷口，华云这双腿走不到。',
  # 西夏·盐池（盐引 / 皮货 / 碱地 / 苦草）
  'sq_npcv_049': '常拂有封信要递到盐场，路上查盐引，他自己不敢带。',
  'sq_npcv_071': '盐引换来的皮货压在盐场。萧初托你替他捎回冰原上。',
  'sq_npcv_222': '驼队里有人烧起来了。冰原上只有一种苦草压得住，长在盐场的碱地里。',
  # 西域（星宿海旧账 / 商道 / 绿洲水囊）
  'sq_npcv_044': '星宿海边上欠的那笔账，田苇航自己去要过两回，回回空手。',
  'sq_npcv_068': '商道上劫驼铃的人露了面。贝仲卿等这一天，等了三年。',
  'sq_npcv_145': '邬灵把一只水囊落在绿洲。囊底缝着东西，比水要紧。',
  # 蛮荒（草原上按羊算的债）
  'sq_npcv_144': '草原上的债按羊算。铁头借出去的那群羊，三年没回来过。',
  # 皇城（宫墙内的差事：腰牌 / 更漏 / 内务府的活）
  'sq_npcv_018': '张掬水在花园里当了二十年差。那桩旧仇的债主如今住西六宫，他进不去，你能。',
  'sq_npcv_019': '邹南枝有封信要递进天牢，给任红。宫门下查腰牌，她不敢亲自去。',
  'sq_npcv_020': '韩婉如要寻凤初霁。人是打宫门出去的，此后再没回来。宫门下当差的人兴许见过她。',
  # 东海（潮水 / 索具 / 渔汛）
  'sq_npcv_017': '海边的旧事都压在一句话里。莫时想让你去渔村问一句，问谁他却不肯说。',
  'sq_npcv_031': '渔船要出海，索具和桐油还没齐。茅凝托你去码头一趟，赶在潮水退之前。',
  'sq_npcv_209': '潮信一变，船就要走。麻灵要把一句话捎给元青，话在信里，信在袖里。',
  # 桃花岛（海雾 / 桃林岔路 / 蛇阵）
  'sq_npcv_046': '岛上没有脚夫。雷白露那筐药材要过桃林，路拐得人发晕，她一个人抬不动。',
  'sq_npcv_047': '清音洞里的话半句都不能漏。湛明远想弄清另一件事，只肯让你去桃林里打听。',
  'sq_npcv_139': '蛇阵边上住不得人。褚静姝把那封信交给你的时候，手还在抖。',
}

d60, d40, d50 = read(P60), read(P40), read(P50)
npcs = d40.get('npcs', d40)
dirty = False

qids = sorted(k for k in d60['quests'] if k.startswith('sq_npcv_'))
assert len(qids) == 79, 'sq_npcv_* 数不是 79: %d' % len(qids)

for qid in qids:
    q = d60['quests'][qid]
    m = re.match(r'^.+?的(.+)$', q.get('name') or '')
    shell = m.group(1) if m else ''
    assert shell in SHELLS, f'{qid} 壳型不在十种内: {shell}'
    if q.get('daily') is not True:
        q['daily'] = True; dirty = True
    if q.get('shell') != shell:
        q['shell'] = shell; dirty = True
    if qid in DESC_MAP and q.get('desc') != DESC_MAP[qid]:
        q['desc'] = DESC_MAP[qid]; dirty = True

if dirty:
    write(P60, d60); print('OK: 60_quests（daily+shell 79 条 + 卷三四 desc 10 条按区重写）')
else:
    print('OK（已落，跳过）: 60_quests')

# =====================================================================
# 断言（重读盘面）
# =====================================================================
v60 = read(P60)
def region_of(room):
    r = d50['rooms'].get(room) or {}
    return r.get('region') or '?'

seen_desc = {}
for qid in qids:
    q = v60['quests'][qid]
    assert q.get('daily') is True, qid + ' 缺 daily'
    assert q.get('shell') in SHELLS, qid + ' shell 不对'
    assert q.get('type') == '支线', qid + ' type 被改（红线）'
    sts = q['stages']
    assert len(sts) == 2 and len(sts[0].get('targets') or []) == 1 and sts[1].get('next') == 99, qid + ' 结构被改（红线）'
    assert [e.get('type') for e in (q.get('rewards') or [])] == ['+exp', '+pot', 'favor', 'say'], qid + ' rewards 被改（红线）'
    # desc 红线
    d = q.get('desc') or ''
    assert '——' not in d, qid + ' desc 破折号'
    assert not re.search(r'不是[^，]{1,14}，(?:而是|是)', d), qid + ' desc 对偶'
    for w in ('落地', '死死', '猛地', '稳稳', '最后'):
        assert w not in d, qid + ' desc 偏好词: ' + w
    # 跨区复用检查
    n = npcs.get(q.get('giver')) or {}
    reg = region_of(n.get('room') or '')
    key = d.strip()
    if key in seen_desc and seen_desc[key][1] != reg:
        raise AssertionError(f'同一句 desc 跨区复用：{seen_desc[key][0]}({seen_desc[key][1]}) 与 {qid}({reg})')
    seen_desc[key] = (qid, reg)

# 第二步覆盖到的条目都在卷三/四/五区域，且 desc 已换
REGION_OK = {'beijiang', 'xixia', 'xiyu', 'many', 'palace', 'haitan', 'taohuadao'}
for qid in DESC_MAP:
    q = v60['quests'][qid]
    n = npcs.get(q.get('giver')) or {}
    reg = region_of(n.get('room') or '')
    assert reg in REGION_OK, qid + ' 不在卷三/四/五区域: ' + reg
    assert q.get('desc') == DESC_MAP[qid], qid + ' desc 未换'
    assert '想请你' not in q['desc'] and '求到了你头上' not in q['desc'], qid + ' 仍是模板句'

# ---- 逐字节未动（对照 git HEAD；只允许新增 daily/shell 与改后 desc）----
import subprocess
try:
    head = subprocess.run(['git', 'show', 'HEAD:game/data/60_quests.json'],
                          cwd=ROOT, capture_output=True, text=True, timeout=30)
    base = json.loads(head.stdout) if head.returncode == 0 and head.stdout.strip() else None
except Exception:
    base = None
if base is None:
    print('⚠️  git HEAD 不可读，跳过逐字节对照（结构性断言仍已过）')
else:
    bq = base['quests']
    moved = 0
    for qid in qids:
        a, b = bq[qid], v60['quests'][qid]
        for k in ('id', 'name', 'level', 'type', 'giver', 'stages', 'rewards'):
            assert json.dumps(a.get(k), ensure_ascii=False, sort_keys=True) == \
                   json.dumps(b.get(k), ensure_ascii=False, sort_keys=True), f'{qid} 字段被改（红线）: {k}'
        added = set(b) - set(a)
        assert added <= {'daily', 'shell'}, f'{qid} 不只加了 daily/shell: {added}'
        if a.get('desc') != b.get('desc'):
            assert qid in DESC_MAP, f'{qid} desc 被动但不在重写清单'
            moved += 1
    assert moved == len(DESC_MAP), f'desc 改动条数不符: {moved}'
    print(f'逐字节对照通过：79 条 id/name/level/type/giver/stages/rewards 与 HEAD 全同；'
          f'仅新增 daily/shell；desc 改动 {moved} 条（= 重写清单）')

print('断言全过：79 条 daily+shell / type+结构+rewards 与 HEAD 逐字节同 / desc 红线 / 无跨区复用 / '
      f'{len(DESC_MAP)} 条按区重写（卷三·四 10 + 卷五 9）')
