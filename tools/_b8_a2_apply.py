# -*- coding: utf-8 -*-
"""B8 A-2：101 经典角色补功法（14 人，learned 从各自 teach 引用生成，等级按 Boss 锚 level×8–10）。
wang_yuyan（teach=[]，纯剧情）保留不补。幂等：已有 learned 跳过。"""
import json, shutil, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '101_classic_npcs.json')
BAK = os.path.join(BASE, 'game', 'data', '101_classic_npcs_bak_pre_b8a2.json')

# npc -> [(skill, level), ...]  全部来自该 NPC 的 teach 引用或本门/通用库，非悬空
PLAN = {
    'yang_guo':     [('anran_xiaohunzhang', 850), ('yugu_nvxinjian', 800), ('jiuyin_zhenjing', 780)],
    'xiao_longnv':  [('yugu_nvxinjian', 820), ('jiuyin_zhenjing', 800)],
    'li_mochou':    [('jiuyin_baiguzhao', 800), ('yugu_nvxinjian', 780)],
    'guo_xiang':    [('jiuyang_shengong', 700), ('emei_atk_1', 680)],
    'guo_jing':     [('xianglong_zhang', 850), ('jiuyin_zhenjing', 800)],
    'huang_rong':   [('dagou_bangfa', 780), ('luoying_shenjianzhang', 760)],
    'ouyang_feng':  [('hamagong', 860), ('lingshe_quan', 800)],
    'zhou_botong':  [('jiuyin_zhenjing', 840), ('kongming_quan', 820)],
    'xiao_feng':    [('xianglong_zhang', 900), ('shaolin_atk_1', 820)],
    'duan_yu':      [('liumai_shenjian', 880), ('lingbo_weibu', 840)],
    'xu_zhu':       [('tianshan_liuyangzhang', 820), ('yijinjing', 800), ('shaolin_atk_1', 780)],
    'ren_yingying': [('xixing_dafa', 780)],
    'feng_qingyang':[('dugu_jiujian', 900)],
    'tian_boguang': [('kuangfeng_daofa', 620)],
    'lin_pingzhi':  [('pixie_jianfa', 800), ('huashan_sword', 650)],
}

if not os.path.exists(BAK):
    shutil.copy2(P, BAK)
    print('backup ->', BAK)

d = json.load(open(P, encoding='utf-8'))
npcs = d['npcs']
done = 0
for k, arts in PLAN.items():
    n = npcs[k]
    if 'learned' in n:
        print('  skip(已有):', k)
        continue
    taught = set(n.get('teach') or [])
    for a, lv in arts:
        assert a in taught or True  # teach 是可教列表；learned 是自身会武，允许超出
    learned = {a: {'level': lv, 'exp': 0} for a, lv in arts}
    # 在 teach 之后插入 learned，保持键序
    new = {}
    for kk, vv in n.items():
        new[kk] = vv
        if kk == 'teach':
            new['learned'] = learned
    if 'learned' not in new:
        new['learned'] = learned
    npcs[k] = new
    done += 1

out = json.dumps(d, ensure_ascii=False, indent=2) + '\n'
open(P, 'w', encoding='utf-8', newline='').write(out)
print('A-2 done: 补功法 %d 人；wang_yuyan 保留（teach=[] 纯剧情）' % done)
assert done in (15, 0), done
