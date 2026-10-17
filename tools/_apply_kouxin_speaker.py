#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_kouxin_speaker.py —— 口信说话人归属 + 黑市护卫文案收口（2026-10-15，游有方）
----------------------------------------------------------------
主人真机反馈：①「输入口信直接就弹剧情，但那个地方有两个人，玩家压根不知道
是谁在说话」——cunzhen_gate 在场两人（孟明月 + 陈二），带口信开场直接进引语
没点名；转交口信通篇只有「她」。②山贼×2 游侠×2 复核的文案连带。

① cunzhen_gate 带口信：开场加陈二归属句（说话人点名级）：
   「陈二朝你挪了半步，声音压下来。」——后两段引语逐字不动。
② 63 shanjiao_inn 转交口信：首句「你见到了她」→「你见到了陈二的姐姐」
   （关系点名，不造新名——姐姐在全库无名，按剧情关系指称）。
③ jm_underground（东市·地下黑市）desc 收口：respawn 定岗 mob_bandit×2
   （count=2 是设计，「山贼×2」非老档残留），但 desc 写「两个寻常护卫」与
   NPC 名「山贼」错位——「寻常护卫」→「抱刀的汉子」，黑市用山贼看场子成立。
幂等：内容比对，两连跑 OK。写盘口径：50_map/63 均 indent=2 + 尾换行。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')
P63 = os.path.join(ROOT, 'game', 'data', '63_mainline_act1.json')

CHEN2_OPENER = "陈二朝你挪了半步，声音压下来。"
JIE_FIRST = "第二天一早，你见到了陈二的姐姐。她三十来岁，手上全是口子，深的那几道用布条缠着。你把话说了。一字不差。"
DESC_OLD = "两个寻常护卫抱着刀蹲在门口，见人下来才抬眼。"
DESC_NEW = "两个抱刀的汉子蹲在门口，见人下来才抬眼。"

d50, d63 = read(P50), read(P63)
dirty50 = dirty63 = False

# ① 带口信开场归属
dai = next(a for a in d50['rooms']['cunzhen_gate']['actions'] if a.get('cmd') == '带口信')
if dai['effects'][0].get('raw') != CHEN2_OPENER:
    dai['effects'].insert(0, {"type": "narrate", "raw": CHEN2_OPENER})
    dirty50 = True

# ③ 黑市 desc 收口
jm = d50['rooms']['jm_underground']
if DESC_OLD in (jm.get('desc') or ''):
    jm['desc'] = jm['desc'].replace(DESC_OLD, DESC_NEW)
    dirty50 = True

# ② 转交口信首句点名
jiao = next(a for a in d63['rooms']['shanjiao_inn']['actions'] if a.get('cmd') == '转交口信')
if jiao['effects'][0].get('raw') != JIE_FIRST:
    jiao['effects'][0]['raw'] = JIE_FIRST
    dirty63 = True

if dirty50:
    write(P50, d50); print('OK: 50_map（①带口信陈二归属句 / ③黑市 desc 护卫→抱刀汉子）')
else:
    print('OK（已落，跳过）: 50_map')
if dirty63:
    write(P63, d63); print('OK: 63_mainline_act1（②转交口信首句点名陈二的姐姐）')
else:
    print('OK（已落，跳过）: 63_mainline_act1')

# ---------- 断言 ----------
v50, v63 = read(P50), read(P63)
dai2 = next(a for a in v50['rooms']['cunzhen_gate']['actions'] if a.get('cmd') == '带口信')
raws = [e.get('raw') for e in dai2['effects'] if e.get('type') == 'narrate']
assert raws[0] == CHEN2_OPENER, '归属句没落'
assert any('我姐嫁到山那头' in (r or '') for r in raws), '原引语被动'
assert any('娘去年冬天没了' in (r or '') for r in raws), '第二段引语被动'
assert len(raws) == 3, '带口信段数不对（应为 1 归属 + 2 引语）'
jiao2 = next(a for a in v63['rooms']['shanjiao_inn']['actions'] if a.get('cmd') == '转交口信')
first = jiao2['effects'][0].get('raw') or ''
assert '陈二的姐姐' in first, '姐姐点名没落'
assert '她三十来岁，手上全是口子' in first, '姐姐描述被动'
assert '码完了她说：「知道了。」' in (jiao2['effects'][1].get('raw') or ''), '第二段被动'
assert DESC_NEW in (v50['rooms']['jm_underground'].get('desc') or ''), '黑市 desc 没收口'
assert DESC_OLD not in (v50['rooms']['jm_underground'].get('desc') or ''), '护卫旧句残留'
# 破折号只查本批触碰的文本（50_map 全文件有 2 处存量——山道 msg/盐场 hint，
# 朱雀历史口径在案，不归本批管）
for tag, blob in (('带口信', json.dumps(dai2['effects'], ensure_ascii=False)),
                  ('转交口信', json.dumps(jiao2['effects'], ensure_ascii=False)),
                  ('黑市desc', v50['rooms']['jm_underground'].get('desc') or '')):
    assert '——' not in blob, tag + ' 破折号混入'
print('断言全过：带口信归属句+两段引语原样 / 姐姐点名+描述原样 / 黑市 desc 收口 / 本批文本无破折号')
