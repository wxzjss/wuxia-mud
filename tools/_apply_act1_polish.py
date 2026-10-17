#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_act1_polish.py —— 卷一第一分钟 + 卷间指路 修批（游有方 2026-10-18）
----------------------------------------------------------------
A1 出生房锚物：road_jiangnan_1 补 8 个可看物件（照 81 交互名词施工图：
   锚物挂 action（anchor + hint:false），点得出、看得到一句本地描写，不新增「此地可做」条目）
A2 引荐信实体：接信 +item letter_intro（行囊里有信，面板/后续凭据才一致）
A3 面板少一步：q_main_jianghu stage0 文案改成两步（先看信 → 再拜师）
A4 软锁指路：北门/南岔两处 say/msg 各加一句往东（青溪村）的指向
B5 卷一→二指向：q_main_jianghu rewards 尾文加「华山道·山脚夜宿」指路
B6 卷四→五指向：q_main_moye rewards 尾文加「东海桃花岛清音洞」指路，并说明为何是黄药师
C7 门派主线观感：q_main_sect 只留冲虚发（从 shaolin_fangzheng.quests 摘掉）

红线：不改 room.desc；锚物 cmd 不以裸「看」开头（用「看茶摊」这类完整动作，靠 lookAtCmd 的
      startsWith('看') 与 keywords 双路命中）；新文本过朱雀；幂等两连跑。
"""
import json, io, os, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(fn, j):
    from _canon_write import write_canon as _wc
    _wc(os.path.join(DATA, fn), j)
def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}

dirty = set()
docs = {}
def doc(fn):
    if fn not in docs:
        docs[fn] = read(fn)
    return docs[fn]

# =====================================================================
# A1 · 出生房锚物（8 个）
# =====================================================================
ANCHORS = [
  ('端详茶摊', '茶摊', ['茶摊', '摊子'],
   '四根竹竿撑着一领芦席，西边那根断过，接了一截，缠着布条。风一过，席子先响。'),
  ('端详芦席', '芦席', ['芦席', '席子'],
   '席子边角磨出了毛。夜里有露，早上要翻过来晒，翻的时候得两个人。'),
  ('端详老槐树', '老槐树', ['老槐树', '槐树', '树'],
   '树身空了半边，孩子往洞里塞过石子。树根把路面顶起一块，绕路的人把那块踩得发白。'),
  ('端详黄泥灶', '黄泥灶', ['黄泥灶', '灶膛', '灶'],
   '灶膛里的炭凉透了，白灰结了一层。老汉天不亮就生火，先烧一壶水给自己。'),
  ('端详水缸', '水缸', ['水缸'],
   '半缸水。缸身一道旧裂纹，裂纹上抹过灰，灰鼓出来一道棱，摸着硌手。'),
  ('端详缸', '缸', ['缸'],
   '缸沿被绳子磨出一圈浅槽。挑水的人来得早，井离这儿有半里地。'),
  ('端详案', '案', ['案', '案面'],
   '案面裂过，用木楔子补的。壶底在案上留了一圈黑印子，擦不掉。'),
  ('端详壶', '壶', ['壶', '茶壶'],
   '缺嘴的壶，倒水得斜着着倒。壶底的烟炱厚，指甲一刮就是一道白。'),
]
room = doc('50_map.json')['rooms']['road_jiangnan_1']
acts = room.setdefault('actions', [])
# 清上一轮误用「看X」的锚物条目（会被 byBypass 吞）
_legacy = [a for a in acts if isinstance(a.get('cmd'), str) and a['cmd'].startswith('看')
           and a.get('anchor') and a.get('hint') is False]
if _legacy:
    acts[:] = [a for a in acts if a not in _legacy]
    dirty.add('50_map.json')
for cmd, anchor, kws, text in ANCHORS:
    want = {"cmd": cmd, "label": '看看' + anchor, "keywords": kws,
            "anchor": anchor, "hint": False,
            "desc": "看看" + anchor,
            "effects": [narr(text)]}
    hit = [a for a in acts if a.get('cmd') == cmd]
    if not hit:
        acts.append(want); dirty.add('50_map.json')
    elif json.dumps(hit[0], ensure_ascii=False, sort_keys=True) != json.dumps(want, ensure_ascii=False, sort_keys=True):
        hit[0].clear(); hit[0].update(want); dirty.add('50_map.json')

# =====================================================================
# A2 · 接信给实体（引荐信）
# =====================================================================
recv = next(a for a in acts if a.get('cmd') == '接信')
if not any(e.get('type') == '+item' and e.get('args', [''])[0] == 'letter_intro' for e in recv['effects']):
    recv['effects'].insert(1, {"type": "+item", "args": ["letter_intro", 1]})
    recv['effects'].insert(2, narr("信进了行囊，粗布还包着，摸着能摸到布的四折。"))
    dirty.add('50_map.json')

# =====================================================================
# A4 · 两处软锁补指路（北门 / 南岔）
# =====================================================================
ex = room['exits']
PTR = '路东那条岔道通青溪村，村口小铺的掌柜识得字，问他。'
for d in ('n', 's'):
    e = ex.get(d)
    if not isinstance(e, dict):
        continue
    if PTR not in (e.get('say') or ''):
        e['say'] = (e.get('say') or '') + '「' + PTR + '」'
        dirty.add('50_map.json')
    if PTR not in (e.get('msg') or ''):
        e['msg'] = (e.get('msg') or '') + PTR
        dirty.add('50_map.json')

# =====================================================================
# A3 / B5 · q_main_jianghu：stage0 两步 + 收尾指路
# =====================================================================
q60 = doc('60_quests.json')['quests']['q_main_jianghu']
new_desc = '先去青溪村·村口小铺，把信给掌柜看一眼（路东出村口，往东走）；再拿这封信拜入一个门派'
if q60['stages'][0].get('desc') != new_desc:
    q60['stages'][0]['desc'] = new_desc
    dirty.add('60_quests.json')
B5 = '往北进南门，出东门沿官道走，到华山道·山脚；夜里在石阶底下宿一晚，会有人来寻你。'
if not any(e.get('type') == 'narrate' and e.get('raw') == B5 for e in q60['rewards']):
    q60['rewards'].append(narr(B5))
    dirty.add('60_quests.json')

# =====================================================================
# B6 · q_main_moye 收尾指路（含为何是黄药师）
# =====================================================================
d66 = doc('66_mainline_act45.json')
qm = d66['quests']['q_main_moye']
B6 = ('半卷纸的事没完。御街上的公文已经接了，可要听清那三句话，还得往东海去：'
      '桃花岛上清音洞里那位不肯上岸，只能你去。')
if not any(e.get('type') == 'narrate' and e.get('raw') == B6 for e in qm['rewards']):
    qm['rewards'].append(narr(B6))
    dirty.add('66_mainline_act45.json')

# =====================================================================
# C7 · q_main_sect 只留冲虚发
# =====================================================================
d65 = doc('65_mainline_act3.json')
fz = (d65.get('npcs') or {}).get('shaolin_fangzheng')
if fz and isinstance(fz.get('quests'), list) and 'q_main_sect' in fz['quests']:
    fz['quests'] = [q for q in fz['quests'] if q != 'q_main_sect']
    dirty.add('65_mainline_act3.json')

# ---------------- 落盘 ----------------
for fn in sorted(dirty):
    write(fn, docs[fn])
print('改动分片:', sorted(dirty) or '（无）')

# =====================================================================
# 断言
# =====================================================================
v50 = read('50_map.json'); rm = v50['rooms']['road_jiangnan_1']
A = {a.get('cmd'): a for a in rm['actions']}
for cmd, anchor, kws, text in ANCHORS:
    a = A.get(cmd)
    assert a, '锚物动作没落: ' + cmd
    assert a.get('anchor') == anchor and a.get('hint') is False, cmd + ' anchor/hint 不对'
    assert not cmd.startswith('看'), cmd + ' 以「看」开头会被 lookAtCmd 的 byBypass 全吃'
    assert any(e.get('raw') == text for e in a['effects']), cmd + ' 描写不对'

r = A['接信']
assert any(e.get('type') == '+item' and e['args'][0] == 'letter_intro' for e in r['effects']), '接信没给引荐信'

for d in ('n', 's'):
    e = rm['exits'][d]
    assert PTR in (e.get('say') or '') and PTR in (e.get('msg') or ''), d + ' 门缺东指句'

q = read('60_quests.json')['quests']['q_main_jianghu']
assert '青溪村' in q['stages'][0]['desc'] and '拜入一个门派' in q['stages'][0]['desc'], 'stage0 未含两步'
assert any(e.get('raw') == B5 for e in q['rewards']), '缺卷一→二指路尾文'
assert any(e.get('raw') == B6 for e in read('66_mainline_act45.json')['quests']['q_main_moye']['rewards']), '缺卷四→五指路尾文'
fz2 = read('65_mainline_act3.json')['npcs']['shaolin_fangzheng']
assert 'q_main_sect' not in (fz2.get('quests') or []), '方证仍挂 q_main_sect'

# 文本红线
import re
blobs = [t for _, _, _, t in ANCHORS] + [PTR, new_desc, B5, B6]
for t in blobs:
    assert '——' not in t, '破折号: ' + t[:20]
    assert not re.search(r'不是[^，]{1,14}，(?:而是|是)', t), '对偶: ' + t[:20]
    for w in ('最后', '落地', '死死', '猛地', '稳稳'):
        assert w not in t, f'偏好词 {w}: ' + t[:20]

print(f'断言全过：锚物 {len(ANCHORS)} 处 / 接信给实体 / 两门指路 / stage0 两步 / '
      '两处卷间指路 / 方证摘掉 q_main_sect / 文本红线')
