#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_build_quest_echoes.py —— 「江湖记得你」数据池（design/110 B 层，游有方 2026-10-18）
----------------------------------------------------------------
按 lead-programmer 定稿的 schema 落 `world.data.questEchoes`：
  { "<questId>": [ { "text": "……{name}……", "region": "jiangnan" }, … ] }

两层：
  Tier1 手写专属句（主线 / 门派 13 / 奇遇 / 批4-7 改造案）—— 说具体事；
  Tier2 区域句兜底（其余有区域的案）—— 用区域物象的模糊说法，不套「某某有件事」模板；
  Tier3 无区域可推的案 → 不落池（引擎静默，不刷空话）。

同时给 q_main_end 落 `endingOnComplete: "jianghu_end:江湖路远"`（lead 方案 a）：
一箭双雕——末章兜底 + 让 data.endings 里声明的 jianghu_end 变可达。

幂等：整块比对，两连跑 OK。写盘 indent=2 + 尾换行。
"""
import json, io, os, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(fn, j):
    from _canon_write import write_canon as _wc
    _wc(os.path.join(DATA, fn), j)
def norm(c):
    if isinstance(c, dict):
        return c
    return {x['id']: x for x in (c or []) if isinstance(x, dict) and x.get('id')}

def deep(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        o = dict(a)
        for k, v in b.items():
            o[k] = deep(o[k], v) if k in o else v
        return o
    return b

FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
quests, npcs = {}, {}
for fn in FILES:
    try:
        d = read(fn)
    except Exception:
        continue
    for qid, q in norm(d.get('quests')).items():
        if isinstance(q, dict):
            quests[qid] = deep(quests.get(qid, {}), q)
    for nid, n in norm(d.get('npcs')).items():
        if isinstance(n, dict):
            npcs[nid] = deep(npcs.get(nid, {}), n)
ROOM2REG = {rid: (r.get('region') or '') for rid, r in read('50_map.json')['rooms'].items()}

def quest_region(q):
    g = q.get('giver') or ''
    room = (npcs.get(g) or {}).get('room') or ''
    if room and room in ROOM2REG:
        return ROOM2REG[room]
    for st in q.get('stages') or []:
        for t in st.get('targets') or []:
            k = t.get('key') or ''
            if k in ROOM2REG:
                return ROOM2REG[k]
    return ''

# ---------------- Tier1：手写专属句（2 条/案） ----------------
T1 = {
  # 主线
  'q_main_jianghu': [
    ('{name}那个名字，如今在江南道口也有人念了。念的人多半没见过本人。', 'jiangnan'),
    ('说书人把{name}的事编成半段，说完了自己摇头，说编不下去了。', 'jiangnan')],
  'q_main_court': [
    ('大理寺那桩旧案的第一句重写了，写的人不是官。', 'palace'),
    ('{name}这个名字，朝里有人记在册子上，册子不给外人看。', 'palace')],
  'q_main_neutral': [
    ('洛阳那边有人说，一个没带腰牌的人把两边的账算明白了。', 'market'),
    ('{name}没入过哪家门，江湖上却肯给个面子。', 'market')],
  # 门派
  'q_huashan_entry': [('华山正气堂的木架上多了块名牌，牌子新，字也新。', 'huashan')],
  'q_shaolin_entry': [('少林知客僧的名册上添了一个法号，写得很正。', 'shaolin')],
  'q_wudang_entry': [('紫霄宫的道童背门规时，多背了一条给新来的人听。', 'wudang')],
  'q_emei_entry': [('峨眉金顶待客的细瓷收起来了，换成了粗碗。', 'emei')],
  'q_gaibang_entry': [('破庙佛座底下留了半个窝头，油纸包得很整齐。', 'gaibang')],
  'q_miao_entry': [('五毒圣堂梁上多挂了一串干草，风过响得像小铃。', 'miaojiang')],
  'q_dali_entry': [('大理王府的人改了口，不再叫「那位客人」。', 'dali')],
  'q_taohua_entry': [('桃花岛一张药方的背面多了个名字，墨很新。', 'taohuadao')],
  'q_huashan_sword_test': [('华山剑坪上的师弟近来爱学几式陌生的剑，学得不像。', 'huashan')],
  'q_huashan_spy': [('岳掌门近来提黑木崖时声音压低半度，说完就换话题。', 'huashan')],
  'q_yijinjing': [('少林后殿的青砖比去年亮，扫地的人换过一个。', 'shaolin')],
  'q_xianglong': [('丐帮的人说，降龙练到火候，撑腰比打人用得上。', 'gaibang')],
  'q_liumai': [('牟尼堂石壁前留了一盏灯，灯芯剪得短，够烧到天亮。', 'dali')],
  # 奇遇
  'q_siguya_sword': [('思过崖的石壁上有人常去看，看守的说看的人不吵。', 'huashan')],
  # 批4-7 改造案（收口有取舍的那些）
  'hk_npcv_241_yinzi': [('绸缎庄那笔窟窿填上了，填的人没在账上留名。', 'market')],
  'hk_npcv_154_maishen': [('妆匣最底下那张纸被烧了，烧的人手很稳。', 'qinglou')],
  'hk_npcv_010_fuxue': [('府学门口那道门换了锁，钥匙在谁手里没人说。', 'market')],
  'hk_npcv_240_laocaifeng': [('那匹攒了三年的绸，后来做成了一件衣裳。', 'market')],
  'hk_npcv_180_beibian': [('北边那趟镖的路线改了，改道的人不肯留名。', 'market')],
  'hk_npcv_009_baizi': [('百子图上的一针补好了，补的人用的线颜色略深。', 'jiangnan')],
  'hk_npcv_090_meimei': [('东市果子摊的秤换了新的，旧秤被收进箱子。', 'jiangnan')],
  'hk_npcv_252_zi': [('雅阁的灯添回三盏，枕下那张纸还在原处。', 'qinglou')],
  'hk_npcv_164_yinzi': [('黑木崖山门的账房换了人，旧账锁进柜里。', 'mojiao')],
  'hk_npcv_164_sirenzhang': [('崖后那口枯井填了土，填土的人没有立碑。', 'mojiao')],
  'hk_npcv_082_mibao': [('天牢院角那层土被刨开过，又踩实了。', 'palace')],
  'hk_npcv_082_hua': [('御书房墙上那幅画挪了半寸，没人说为什么。', 'palace')],
  # 经典人物支线
  'sq_yang_guo_muqian': [('古墓前那坛酒空了，坛子还摆着，没人收。', 'gumu')],
  'sq_xiao_longnv_chumen': [('终南山的墓门开过一回，风灌进去，又关上。', 'gumu')],
  'sq_feng_qingyang_shoujian': [('崖上那把剑不见了，崖边多了一道新划的痕。', 'huashan')],
  'sq_guo_jing_shoucheng': [('城头那批箭用完了，垛口补过一层新土。', 'palace')],
  'sq_xiao_feng_shenshi': [('有人问起他到底姓什么，问的人自己先笑了。', 'gaibang')],
}

# ---------------- Tier2：区域句兜底（来自 design/110-echo-pool.json） ----------------
POOL = read(os.path.join(ROOT, 'design', '110-echo-pool.json'))['regions']

echoes = {}
for qid, q in quests.items():
    reg = quest_region(q)
    if qid in T1:
        echoes[qid] = [{"text": t, "region": r} for t, r in T1[qid]]
    elif reg and reg in POOL and q.get('type') != '主线':
        echoes[qid] = [{"text": t, "region": reg} for t in POOL[reg]]

# ---------------- 落盘 ----------------
d60 = read('60_quests.json')
changed = False
if d60.get('questEchoes') != echoes:
    d60['questEchoes'] = echoes
    changed = True
# q_main_end 的结局兜底（lead 方案 a）
d66 = read('66_mainline_act45.json')
q_end = (d66.get('quests') or {}).get('q_main_end')
if q_end is not None and q_end.get('endingOnComplete') != 'jianghu_end:江湖路远':
    q_end['endingOnComplete'] = 'jianghu_end:江湖路远'
    changed = True
if changed:
    write('60_quests.json', d60)
    write('66_mainline_act45.json', d66)
    print('OK: 60_quests（questEchoes %d 案） + 66_mainline_act45（q_main_end.endingOnComplete）' % len(echoes))
else:
    print('OK（已落，跳过）: questEchoes %d 案 + endingOnComplete' % len(echoes))

# ---------------- 断言 ----------------
v60 = read('60_quests.json')
pe = v60['questEchoes']
assert len(pe) >= 100, '池子太小: %d' % len(pe)
bad = []
for qid, arr in pe.items():
    assert qid in quests, '池子里有悬空 quest: ' + qid
    assert isinstance(arr, list) and arr, qid + ' 空池'
    for it in arr:
        t = it.get('text') or ''
        assert t and len(t) <= 40, f'{qid} 句长异常: {len(t)}'
        for w in ('最后', '落地', '死死', '猛地', '稳稳'):
            assert w not in t, f'{qid} 偏好词: {w}'
        assert '——' not in t, qid + ' 破折号'
        assert not re.search(r'不是[^，]{1,14}，(?:而是|是)', t), qid + ' 对偶'
        assert '{name}' not in t or t.count('{name}') == 1, qid + ' 占位符异常'
# 区域句不跨区错配：Tier2 的 region 必须等于任务推断区
for qid, arr in pe.items():
    if qid in T1:
        continue
    reg = quest_region(quests[qid])
    assert all(it.get('region') == reg for it in arr), qid + ' 区域句错配'
# 结局兜底
v66 = read('66_mainline_act45.json')
assert v66['quests']['q_main_end'].get('endingOnComplete') == 'jianghu_end:江湖路远', 'endingOnComplete 未落'

t1 = sum(1 for k in pe if k in T1)
print(f'断言全过：{len(pe)} 案有池（Tier1 手写 {t1} + Tier2 区域句 {len(pe)-t1}）/ '
      '句长≤40 / 无偏好词与对偶 / 无悬空 quest / q_main_end 结局兜底已落')
