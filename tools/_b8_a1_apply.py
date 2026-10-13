# -*- coding: utf-8 -*-
"""B8 A-1：43 七门 rank4 副掌门 learned 等级提到 150–200（段内正则替换，不整文件重写）。"""
import json, re, shutil, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '43_sect_disciples.json')
BAK = os.path.join(BASE, 'game', 'data', '43_sect_disciples_bak_pre_b8a1.json')

PLAN = {  # npc_id -> 目标 learned_max（150–200 区间，各门错开）
    'disciple_huashan_0': 170,
    'disciple_shaolin_0': 180,
    'disciple_wudang_0': 175,
    'disciple_emei_0': 165,
    'disciple_gaibang_0': 185,
    'disciple_mojiao_0': 160,
    'disciple_dali_0': 190,
}

raw = open(P, encoding='utf-8').read()
if not os.path.exists(BAK):
    shutil.copy2(P, BAK)
    print('backup ->', BAK)

keys = list(PLAN) + ['disciple_taohua_0']  # 分段锚点用（taohua_0 只作下界参考不改动）
pos = {k: raw.find('"%s"' % k) for k in PLAN}
assert all(pos[k] > 0 for k in PLAN), pos
order = sorted(pos.items(), key=lambda x: x[1])
ends = []
for i, (k, p) in enumerate(order):
    nxt = [q for kk, q in order if q > p]
    ends.append(min(nxt) if nxt else len(raw))

changed = 0
segs = []
for (k, p), e in zip(order, ends):
    seg = raw[p:e]
    # 实际取 learned 块
    m = re.search(r'"learned"\s*:\s*\{', seg)
    assert m, k
    start = m.end()
    depth = 1
    i = start
    while depth:
        if seg[i] == '{':
            depth += 1
        elif seg[i] == '}':
            depth -= 1
        i += 1
    block = seg[start:i - 1]
    learned = json.loads('{' + block + '}')
    old_max = max(v['level'] for v in learned.values())
    tgt = PLAN[k]
    f = tgt / old_max
    new_block = block
    for a, v in learned.items():
        newlv = min(200, max(150, round(v['level'] * f))) if v['level'] > 100 else round(v['level'] * f)
        # 只把最高那一档（level>100 的武功）拉进区间，basic/jh 低阶按比例走不设钳制
        old_pat = '"%s"' % a
        # 在 block 内精确替换该键下的 level
        mb = re.search(r'"%s"\s*:\s*\{\s*"level"\s*:\s*(\d+)' % re.escape(a), new_block)
        assert mb, (k, a)
        new_block = new_block[:mb.start(1)] + str(newlv) + new_block[mb.end(1):]
    seg2 = seg[:start] + new_block + seg[i - 1:]
    if seg2 != seg:
        changed += 1
    segs.append(seg2)

# 校验新 learned_max
for (k, p), e, seg2 in zip(order, ends, segs):
    m = re.search(r'"learned"\s*:\s*\{', seg2)
    start = m.end(); depth = 1; i = start
    while depth:
        if seg2[i] == '{': depth += 1
        elif seg2[i] == '}': depth -= 1
        i += 1
    learned = json.loads('{' + seg2[start:i - 1] + '}')
    mx = max(v['level'] for v in learned.values())
    assert 150 <= mx <= 200, (k, mx)
    print(' ', k, 'learned_max ->', mx, {a: v['level'] for a, v in learned.items()})

# 从后往前拼接（避免位移）
out = raw
for (k, p), e, seg2 in sorted(zip(order, ends, segs), key=lambda x: -x[0][1]):
    out = out[:p] + seg2 + out[e:]
assert out != raw and changed == 7
open(P, 'w', encoding='utf-8', newline='').write(out)
print('A-1 done: 7 人 learned_max 提至 150–200，替换段 7 段')
