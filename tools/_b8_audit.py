#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_b8_audit.py —— B8 只读盘点（游有方 2026-10-18，二版）
----------------------------------------------------------------
只读：不改 game/data/*.json，只产台账 + 终端摘要。

⚠️ 口径修正（首版踩过）：**grade 是倒序** —— 1 = 绝学，9 = 基础。
   证据：huashan_atk_3「华山绝剑」grade 1 / basic_fist grade 9；
   门派档位三型：(7,4,1) 大派 / (8,5,2) 中派 / (9,6,3) 野派。
   ⇒ 「高身份低配」判据 = 通身 grade ≥ 7；「低身份高配」= 任一槽 grade ≤ 3。

产出：tools/_out_b8_npc.tsv（每 NPC 一行 + 违和标记）
      tools/_out_b8_skill.tsv（每技能一行）
      tools/_out_b8_issues.tsv（逐条违和）
"""
import json, io, os, re
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def norm(coll):
    if isinstance(coll, dict):
        return coll
    out = {}
    if isinstance(coll, list):
        for x in coll:
            if isinstance(x, dict) and x.get('id'):
                out[x['id']] = x
    return out

def deep(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        o = dict(a)
        for k, v in b.items():
            o[k] = deep(o[k], v) if k in o else v
        return o
    return b

FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
skills, npcs, src_npc = {}, {}, {}
for fn in FILES:
    try:
        d = read(fn)
    except Exception:
        continue
    for sid, s in norm(d.get('skills')).items():
        if isinstance(s, dict):
            skills[sid] = deep(skills.get(sid, {}), s)
    for nid, n in norm(d.get('npcs')).items():
        if isinstance(n, dict):
            npcs[nid] = deep(npcs.get(nid, {}), n)
            src_npc[nid] = fn

SECTS = set(norm(read('30_sects.json').get('sects')).keys())
ROOM2REG = {rid: (r.get('region') or '?') for rid, r in read('50_map.json')['rooms'].items()}
MOVE_T = ('拳', '剑', '刀', '棍', '暗器', '鞭')

SK = {}
for sid, s in skills.items():
    m = re.match(r'^([a-z]+)_', sid)
    pref = m.group(1) if m else ''
    SK[sid] = dict(id=sid, name=s.get('name') or '', type=s.get('type') or '',
                   grade=s.get('grade'), damageMult=s.get('damageMult'),
                   maxLevel=s.get('maxLevel'), sect=(pref if pref in SECTS else ''),
                   pref=pref, desc=s.get('desc') or '')

def grade_band(g):
    if not isinstance(g, int):
        return '?'
    return '绝学' if g <= 3 else ('中阶' if g <= 6 else '入门')

# ---------- NPC 画像 ----------
def role_of(nid, n):
    if str(nid).startswith('mob_') or n.get('tier') == 'mob':
        return 'mob'
    if str(nid).startswith('disciple_'):
        return '弟子'
    if str(nid).startswith('guard_') or n.get('tag') == 'shouwei':
        return '守卫'
    if str(nid).startswith('master_'):
        return '掌门'
    if str(nid).startswith('elder_') or (n.get('rank') or 0) >= 4:
        return '长老/高层'
    if n.get('sect') in SECTS:
        return '门人'
    return '散人/平民'

def infer_sect(nid, n):
    if n.get('sect') in SECTS:
        return n['sect']
    m = re.match(r'^(?:disciple|guard|master|elder)_([a-z]+)', str(nid))
    if m and m.group(1) in SECTS:
        return m.group(1)
    return ''

NPC = {}
for nid, n in npcs.items():
    sk = n.get('skills') if isinstance(n.get('skills'), dict) else {}
    learned = n.get('learned') if isinstance(n.get('learned'), dict) else {}
    rows = []
    for slot, sid in sk.items():
        if not isinstance(sid, str):
            continue
        s = SK.get(sid) or {}
        lv = learned.get(sid)
        rows.append(dict(slot=slot, sid=sid, name=s.get('name', ''), type=s.get('type', ''),
                         grade=s.get('grade'), sect=s.get('sect', ''),
                         level=(lv.get('level') if isinstance(lv, dict) else lv)))
    # 口径补充（2026-10-18）：绝学档 skill 若 learned 等级 ≤ 80，视为「挂名未成」——
    # 品阶是上限不是现有火候（例：鲍归 jiuyang_shengong g1 但只练到 40 级）。
    # 仍计入「有没有这门」的展示，但不计入 maxGrade/minGrade 的身份判定。
    gs = [r['grade'] for r in rows
          if isinstance(r['grade'], int) and not (r['grade'] <= 3 and isinstance(r.get('level'), int) and r['level'] <= 80)]
    NPC[nid] = dict(id=nid, name=n.get('name') or '', tier=n.get('tier') or '-',
                    role=role_of(nid, n), sect=infer_sect(nid, n), rank=n.get('rank') or 0,
                    level=n.get('level') or 0, room=n.get('room') or '', src=src_npc.get(nid, ''),
                    rows=rows, maxGrade=max(gs) if gs else None,
                    minGrade=min(gs) if gs else None, nSkills=len(rows),
                    learnedOnly=[k for k in learned] if (not rows and learned) else [])

# ---------- 违和判定 ----------
issues = []
def add(kind, nid, detail):
    v = NPC[nid]
    issues.append(dict(kind=kind, id=nid, name=v['name'], tier=v['tier'], role=v['role'],
                       sect=v['sect'] or '-', detail=detail))

for nid, v in NPC.items():
    # ③ 有 learned 无 skills（打不出绝学）—— 不依赖 grade，先判
    if v['learnedOnly']:
        add('身份错配·学了绝学但没装槽位', nid,
            'learned=%s，skills 无映射' % ','.join(v['learnedOnly'][:4]))
    if v['minGrade'] is None:
        continue
    # ① 身份错配
    # 低火候绝学（learned ≤80）单列成「挂名未成」，不算身份错配但留痕
    _weak = [r for r in v['rows'] if isinstance(r['grade'], int) and r['grade'] <= 3
             and isinstance(r.get('level'), int) and r['level'] <= 80]
    if v['role'] in ('散人/平民', '守卫', '弟子', '门人') and _weak and v['minGrade'] > 3:
        add('挂名未成·绝学只练到低火候', nid,
            '绝学档但 learned≤80：' + ','.join(f"{r['sid']}(g{r['grade']}/lv{r['level']})" for r in _weak[:3]))
    if v['role'] in ('散人/平民', '守卫', '弟子', '门人') and v['minGrade'] <= 3 and v['tier'] != 'A':
        add('身份错配·低身份持绝学', nid,
            'minGrade=%d（%s）绝学池: %s' % (v['minGrade'], v['role'],
             ','.join(f"{r['slot']}:{r['sid']}(g{r['grade']})" for r in v['rows'] if isinstance(r['grade'], int) and r['grade'] <= 3)[:80]))
    if v['role'] in ('掌门', '长老/高层') and v['minGrade'] >= 7:
        add('身份错配·高身份只会入门', nid,
            '通身 grade≥7（%s）: %s' % (v['role'], ','.join(f"{r['sid']}(g{r['grade']})" for r in v['rows'])[:80]))
    # ② 门派错配
    if v['sect']:
        _cs = set(npcs[nid].get('crossSect') or [])
        foreign = [r for r in v['rows'] if r['sect'] and r['sect'] != v['sect'] and r['sid'] not in _cs]
        if foreign:
            add('门派错配·用别派武学', nid,
                '本门=%s；异派=%s' % (v['sect'], ','.join(f"{r['sid']}({r['sect']})" for r in foreign[:4])))
    # ②b 绝学招式 + 无内功/入门内功
    inner = [r for r in v['rows'] if r['type'] == '内功']
    moves = [r for r in v['rows'] if r['type'] in MOVE_T]
    gi = min([r['grade'] for r in inner if isinstance(r['grade'], int)] or [99])
    gm = min([r['grade'] for r in moves if isinstance(r['grade'], int)] or [99])
    if moves and gm <= 3 and gi >= 7 and not v['sect'] and inner:
        # 无门派 + 绝学 + 通用内功：按**修为**再分两类（品阶是上限，不是现有火候）
        _real = [r for r in moves if isinstance(r['grade'], int) and r['grade'] <= 3
                 and not (isinstance(r.get('level'), int) and r['level'] <= 80)]
        if _real:
            add('无门派高手·剧情（合法，留痕）', nid,
                '招式=%s（最高火候 %s）' % (','.join(r['sid'] for r in _real[:2]),
                 max([r['level'] for r in _real if isinstance(r.get('level'), int)] or [0])))
        else:
            add('挂名未成·绝学只练到低火候', nid,
                '招式=%s（learned≤80）/ 内功=%s' % (
                 ','.join(f"{r['sid']}(lv{r.get('level')})" for r in moves[:2]),
                 ','.join(r['sid'] for r in inner[:2]) or '无'))
    elif moves and gm <= 3 and gi >= 7:
        add('配套错配·绝学招式配入门内功', nid,
            '招式=%s（g%d）/ 内功=%s（g%d）' % (
                ','.join(r['sid'] for r in moves[:2]), gm,
                ','.join(r['sid'] for r in inner[:2]) or '无', gi))
    # ③ 有 learned 无 skills（打不出绝学）由上方统一判，此处不再重复

# ③b 层级：mob vs 同区人类（mob room 常为 None → 用 level 全局分位 + 技能档）
humans = [v['level'] for v in NPC.values() if v['role'] != 'mob' and v['level']]
humans.sort()
q70 = humans[int(len(humans) * 0.7)] if humans else 0
for nid, v in NPC.items():
    if v['role'] != 'mob':
        continue
    reg = ROOM2REG.get(v['room'], '?')
    if v['level'] and v['level'] > q70:
        add('层级错配·mob 等级过高', nid, f"level={v['level']} > 人类 70 分位 {q70}")
    if v['minGrade'] is not None and v['minGrade'] <= 4:
        add('层级错配·mob 持高阶武学', nid,
            'grade: ' + ','.join(f"{r['sid']}(g{r['grade']})" for r in v['rows']))

# ---------- 武学体系 ----------
skill_issues = []
byname = defaultdict(list)
for k in SK.values():
    if k['name']:
        byname[k['name']].append(k)
for nm, arr in byname.items():
    secs = {a['sect'] for a in arr if a['sect']}
    if len(arr) > 1 and len(secs) > 1:
        skill_issues.append(dict(kind='同名异派', id='|'.join(a['id'] for a in arr), name=nm,
                                 detail='; '.join(f"{a['id']}({a['sect'] or '通用'},g{a['grade']})" for a in arr)))

# 门派档位
band = {}
for sid, k in SK.items():
    m = re.match(r'^([a-z]+)_(atk|force|guard|fly|qimen)_([123])$', sid)
    if m and m.group(1) in SECTS:
        band.setdefault(m.group(1), {})[m.group(3)] = k['grade']

# 品阶-威力（招式）
mv = [k for k in SK.values() if k['type'] in MOVE_T and isinstance(k['grade'], int)
      and isinstance(k['damageMult'], (int, float)) and k['damageMult'] > 0]
slope = inter = None
if mv:
    import statistics
    gs = [k['grade'] for k in mv]; ds = [k['damageMult'] for k in mv]
    mg, md = statistics.mean(gs), statistics.mean(ds)
    var = sum((g - mg) ** 2 for g in gs) or 1
    slope = sum((g - mg) * (d - md) for g, d in zip(gs, ds)) / var
    inter = md - slope * mg
    for k in sorted(mv, key=lambda x: -abs(x['damageMult'] - (inter + slope * x['grade'])))[:10]:
        r = k['damageMult'] - (inter + slope * k['grade'])
        skill_issues.append(dict(kind='品阶与威力不符', id=k['id'], name=k['name'],
                                 detail=f"grade={k['grade']} dmg={k['damageMult']} 残差={r:+.3f}"))

# ---------- 摘要 ----------
print('武学总数:', len(SK), '| NPC 总数:', len(NPC), '| 门派数:', len(SECTS))
print('有 skills 映射:', sum(1 for v in NPC.values() if v['nSkills']), '| 无映射:', sum(1 for v in NPC.values() if not v['nSkills']))
print('\n== 角色分布 ==')
print(Counter(v['role'] for v in NPC.values()).most_common())
print('\n== 各角色 grade 区间（1=绝学 9=入门） ==')
for role in ['掌门', '长老/高层', '门人', '弟子', '守卫', '散人/平民', 'mob']:
    sub = [v for v in NPC.values() if v['role'] == role and v['minGrade'] is not None]
    if sub:
        print(f' {role}: n={len(sub)} minGrade 分布 {dict(sorted(Counter(v["minGrade"] for v in sub).items()))} '
              f'| maxGrade 分布 {dict(sorted(Counter(v["maxGrade"] for v in sub).items()))}')
print('\n== 门派档位（入门/中阶/绝学） ==')
print(' ', dict(sorted((k, tuple(v.get(x) for x in ('1', '2', '3'))) for k, v in band.items())))
print(' 分型:', Counter(tuple(v.get(x) for x in ('1', '2', '3')) for v in band.values()).most_common())
print('\n== 违和计数 ==')
for k, c in Counter(i['kind'] for i in issues).most_common():
    print(f'  {k}: {c}')
print(' 合计:', len(issues), '| 涉及 NPC 唯一数:', len({i["id"] for i in issues}))
print('\n== 武学体系问题 ==')
for k, c in Counter(i['kind'] for i in skill_issues).most_common():
    print(f'  {k}: {c}')
print(f'  招式 dmg~grade: n={len(mv)} slope={slope:.3f} intercept={inter:.3f}（负=品阶越高威力越大，符合预期）')

# ---------- 台账 ----------
def w(name, header, rows):
    with io.open(os.path.join(ROOT, 'tools', name), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\t'.join(header) + '\n')
        for r in rows:
            f.write('\t'.join(str(x) for x in r) + '\n')

kinds = defaultdict(list)
for i in issues:
    kinds[i['id']].append(i['kind'])
w('_out_b8_npc.tsv',
  ['id', 'name', 'tier', 'role', 'sect', 'rank', 'level', 'room', 'nSkills', 'minGrade', 'maxGrade', 'slots', 'issueKinds'],
  [[v['id'], v['name'], v['tier'], v['role'], v['sect'] or '-', v['rank'], v['level'], v['room'],
    v['nSkills'], v['minGrade'], v['maxGrade'],
    ','.join(f"{r['slot']}={r['sid']}(g{r['grade']})" for r in v['rows']),
    ','.join(sorted(set(kinds.get(v['id'], []))))] for v in sorted(NPC.values(), key=lambda x: x['id'])])
w('_out_b8_skill.tsv', ['id', 'name', 'type', 'grade', 'band', 'damageMult', 'maxLevel', 'sect'],
  [[k['id'], k['name'], k['type'], k['grade'], grade_band(k['grade']), k['damageMult'], k['maxLevel'], k['sect'] or '-']
   for k in sorted(SK.values(), key=lambda x: x['id'])])
w('_out_b8_issues.tsv', ['kind', 'id', 'name', 'tier', 'role', 'sect', 'detail'],
  [[i['kind'], i['id'], i['name'], i['tier'], i['role'], i['sect'], i['detail']] for i in issues]
  + [[i['kind'], i['id'], i['name'], '-', '-', '-', i['detail']] for i in skill_issues])
print('\n台账: tools/_out_b8_npc.tsv / _out_b8_skill.tsv / _out_b8_issues.tsv')
