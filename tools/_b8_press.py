# -*- coding: utf-8 -*-
"""B8 散人压级（40_npcs，6 批每批 ≤60 人）。
锚点：普通 ×1.0 / tierB ×1.2 / tierA ×1.8 / mob 小怪 ×0.8 / 主线强制战斗例外 ×2.2（cap 120）。
保 NPC 内梯度：按原等级比例缩放，使 max 恰落在锚上；单项 floor 5。
幂等：已压过的（max ≤ cap）跳过。用法：python _b8_press.py <batch 1..6>"""
import json, sys, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '40_npcs.json')

EXCEPT = {'mob_bandit', 'mob_bandit_chief', 'mob_mo_disciple', 'mob_assassin',
          'mob_soldier', 'mob_snake', 'mob_wolf',  # 主线 combat:/击杀清单引用，剧情档 ×2.2
          'depot_master', 'depot_shadow'}  # act45 主线终 Boss（combat: 引用），原值保留不压
KEEP = {'depot_master', 'depot_shadow'}  # 完全不压

d = json.load(open(P, encoding='utf-8'))
npcs = d['npcs']

def ratio_target(k, n):
    if k in EXCEPT:
        return 2.2
    if k.startswith('mob_'):
        return 0.8
    t = n.get('tier')
    return {'A': 1.8, 'B': 1.2}.get(t, 1.0)

def learn_max(n):
    return max(v['level'] for v in n['learned'].values())

targets = []
for k, n in npcs.items():
    if k.startswith(('npcv_', 'mob_', 'wen_', 'beggar_', 'old_', 'guan_')) or (not n.get('sect') and not n.get('rank') and n.get('learned') and n.get('level') is not None):
        if not n.get('learned') or n.get('level') is None:
            continue
        if n.get('sect') and n.get('rank') is not None:
            continue  # 门派人物不碰
        targets.append(k)
targets = sorted(set(targets))
# 排除掌门级误入（double check）
targets = [k for k in targets if not (npcs[k].get('rank') is not None and npcs[k]['rank'] >= 4)]

batch = int(sys.argv[1])
B = 60
chunks = [targets[i:i + B] for i in range(0, len(targets), B)]
print('总目标 %d 人，%d 批；本批 #%d：%d 人' % (len(targets), len(chunks), batch, len(chunks[batch - 1]) if batch <= len(chunks) else 0))
assert batch <= len(chunks)

n_press = n_skip = 0
for k in chunks[batch - 1]:
    n = npcs[k]
    mx = learn_max(n)
    if k in KEEP:
        n_skip += 1
        continue
    rt = ratio_target(k, n)
    cap = 120 if k in EXCEPT else 100
    want_max = min(cap, max(6, round(n['level'] * rt)))
    if mx <= want_max + 1:
        n_skip += 1
        continue
    f = want_max / mx
    for v in n['learned'].values():
        v['level'] = max(5, round(v['level'] * f))
    n_press += 1

out = json.dumps(d, ensure_ascii=False, indent=1)
assert not out.endswith('\n')
open(P, 'w', encoding='utf-8', newline='').write(out)
print('本批压 %d 人，跳过(已达标) %d 人' % (n_press, n_skip))
# 汇报本批样本
for k in chunks[batch - 1][:8]:
    n = npcs[k]
    print('  ', k, 'lv=%s max=%d tier=%s' % (n.get('level'), learn_max(n), n.get('tier')))
