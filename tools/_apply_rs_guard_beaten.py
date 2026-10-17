#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_rs_guard_beaten.py —— 「打伤守门人」负面传闻种子（游有方，2026-10-18）
--------------------------------------------------------------------------------
design/104 配套·催收件①：guards.js onGuardBeaten 的 rs_sect_join（拜师喜报）
极性反向已摘（寇豆码 2026-10-18，打伤守门人播出拜师传闻=语义反向），
本件补上**专属负面种子**，note 回调点注释已在他的 lane 留好。

种子规格（与 70_world.json 现有种子同款字段）：
  · id rs_guard_beaten，kind 门派，polarity -1（恶事）；
  · weight 2.5 / heat0 70 / tauDays 10 / ttlDays 25——量级对齐 rs_sect_join /
    rs_sect_betray（同为一桩可传的门派事，热度略低：打人不如叛门轰动）；
  · loud true——山门口动手，人多眼杂，「扬名」性质的恶事本就该四处传
    （rumorfeed note 的纪律：不能自作主张 silent，那等于取消「目击」设计）；
  · marks ["血案"]? 不用——那是出人命的档。用既有词「江湖」+「风评」，
    语义=门派间的口碑事，可被「风声」按类捞出来。

texts 三档（true 全知 / half 传闻走样 / false 越传越玄），红线自查：
  无破折号 / 无旁白对偶（texts 字段不走台词豁免）/ 无朱雀偏好词 / {who}{where} 占位符齐全。

幂等：种子已存在则跳过。改完跑 ai-flavor-check 复验。
"""
import json, io, os, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P70 = os.path.join(ROOT, 'game', 'data', '70_world.json')

SEED = {
    "id": "rs_guard_beaten",
    "kind": "门派",
    "polarity": -1,
    "weight": 2.5,
    "heat0": 70,
    "tauDays": 10,
    "ttlDays": 25,
    "loud": True,
    "texts": {
        "true": "{who}在{where}山门前动了手，把守门的打得不轻。这样的事，门里不会忘。",
        "half": "有人说{who}在{where}闯了山门，连守门的都挨了打，不知真假。",
        "false": "{who}在{where}连挑一派山门，守门人排着队挨打，好生了得！",
    },
    "marks": ["江湖", "风评"],
}

d = json.load(io.open(P70, encoding='utf-8'))
seeds = d.setdefault('rumorSeeds', {})
if 'rs_guard_beaten' in seeds:
    print('OK（已落，跳过）: rs_guard_beaten 种子已在场')
else:
    seeds['rs_guard_beaten'] = SEED
    _p = P70
    if not os.path.isabs(_p):
        _base = globals().get('DATA') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game', 'data')
        _p = os.path.join(_base, _p)
    _raw = open(_p, 'rb').read()
    _bom = _raw.startswith(b'\xef\xbb\xbf')
    _crlf = b'\r\n' in _raw[:2000]
    _s = json.dumps(d, ensure_ascii=False, indent=1)
    if _crlf:
        _s = _s.replace('\n', '\r\n')
    with open(_p, 'wb') as _f:
        _f.write((b'\xef\xbb\xbf' if _bom else b'') + _s.encode('utf-8'))
    print('OK: 70_world.json 新增 rs_guard_beaten（打伤守门人·负面传闻种子）')

# ---------------- 断言（重读盘面） ----------------
v = json.load(io.open(P70, encoding='utf-8'))
s = v['rumorSeeds']['rs_guard_beaten']
assert s['polarity'] == -1 and s['loud'] is True, '极性/loud 被动'
assert set(s['texts'].keys()) == {'true', 'half', 'false'}, 'texts 三档不全'
for tier, t in s['texts'].items():
    assert '{who}' in t and '{where}' in t, tier + ' 占位符缺失'
    assert '——' not in t, tier + ' 破折号混入'
    assert '不是' not in t or '，是' not in t, tier + ' 旁白对偶混入'
# 既有种子未被挤掉
for keep in ('rs_sect_join', 'rs_sect_betray', 'rs_dungeon_clear', 'rs_tournament_win'):
    assert keep in v['rumorSeeds'], '既有种子被挤: ' + keep
print('断言全过：三档 texts / 占位符 / 无破折号无对偶 / 既有种子保全')
