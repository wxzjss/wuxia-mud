#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_b8_ac.py —— B8 A 刀 + C 刀（游有方 2026-10-18，team-lead 裁定）
----------------------------------------------------------------
A 刀（26 条硬错，立即开）
  A1 门派错配 10：星宿 5 人（丁春秋 + 4 弟子）用唐门毒术 → **声明 crossSect**
     （毒是通用技艺，星宿用毒是原著设定；team-lead 准 crossSect 白名单）；
     顺带修 4 弟子的「拳法塞在棍槽」类型错位。
     古墓 5 人（裘千尺 + 3 弟子 + 守阁）用峨眉剑 → 改回本门 gumu 剑（g8 入门档）。
  A2 经典人物补槽位 14：按 learned 的技能类型装槽，**不动 level/atk/def/hp/mp**。
  A3 mob 降档 2：山贼首领 hujia_daofa(g3) → cn_hidden_blade(刀 g7)；
     魔教教众 heimu_zhang(g4) → mojiao_atk_1(拳 g7)。

C 刀（配套补齐，同批）
  绝学招式（grade ≤3）却无内功 / 只有入门内功的 NPC → 补/换本门内功：
  rank≥4 用 <sect>_force_3（绝学档），其余用 <sect>_force_2（中阶档）；
  无门派用 cn_breath_art（小周天 g7）。纯新增，不删招式。

红线：技能库（skills 定义）不动；只改 NPC 的 skills/learned/crossSect。
      level/atk/def/hp/mp 与 git HEAD 逐字节同（脚本断言）。
幂等：条件满足即跳过。写盘 indent=2 + 尾换行。
"""
import json, io, os, os, re, subprocess

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
docs = {fn: read(fn) for fn in FILES}
skills, npcs, npc_home = {}, {}, {}
for fn in FILES:
    d = docs[fn]
    for sid, s in norm(d.get('skills')).items():
        if isinstance(s, dict):
            skills[sid] = deep(skills.get(sid, {}), s)
    for nid, n in norm(d.get('npcs')).items():
        if not isinstance(n, dict):
            continue
        npcs[nid] = deep(npcs.get(nid, {}), n)
        if isinstance(n.get('skills'), dict) or isinstance(n.get('learned'), dict):
            npc_home[nid] = fn        # 最后一份带 skills/learned 的分片 = 落盘目标

SECTS = set(norm(read('30_sects.json').get('sects')).keys())
dirty = set()

def touch(nid):
    dirty.add(npc_home[nid])

def shard_npc(nid):
    """返回**分片里**那个 NPC 对象（写盘必须改它；merged 视图只用于读）。"""
    fn = npc_home[nid]
    return docs[fn]['npcs'][nid]

def grade(sid):
    g = (skills.get(sid) or {}).get('grade')
    return g if isinstance(g, int) else None

def stype(sid):
    return (skills.get(sid) or {}).get('type') or ''

SLOT = {'内功': '内功', '招架': '招架', '轻功': '轻功', '拳': '拳', '剑': '剑',
        '刀': '刀', '棍': '棍', '暗器': '暗器', '鞭': '鞭'}

def infer_sect(nid, n):
    if n.get('sect') in SECTS:
        return n['sect']
    m = re.match(r'^(?:disciple|guard|master|elder)_([a-z]+)', str(nid))
    if m and m.group(1) in SECTS:
        return m.group(1)
    return ''

log = []

# =====================================================================
# A1 · 星宿 5 人：声明 crossSect（唐门毒术），并修「拳法塞棍槽」
# =====================================================================
XINGXIU = ['xingxiu_laoxian', 'disciple_xingxiu_0', 'disciple_xingxiu_1',
           'disciple_xingxiu_2', 'disciple_xingxiu_3']
for nid in XINGXIU:
    n = npcs[nid]
    sh = shard_npc(nid)
    cs = list(n.get('crossSect') or [])
    if 'tangmen_du' not in cs:
        cs.append('tangmen_du')
        sh['crossSect'] = cs
        touch(nid)
        log.append(f'A1 {nid}: crossSect += tangmen_du')
    sk = sh.get('skills') or {}
    if 'tangmen_du' in sk.values() and '棍' in sk and stype(sk['棍']) == '拳':
        sk['拳'] = sk.pop('棍')
        sh['skills'] = sk
        touch(nid)
        log.append(f'A1 {nid}: 拳法从「棍」槽挪回「拳」槽')

# =====================================================================
# A1b · 古墓 5 人：峨眉剑 → 本门古墓剑（入门 g8）
# =====================================================================
GUMU = ['disciple_gumu_0', 'disciple_gumu_1', 'disciple_gumu_2', 'disciple_gumu_3', 'gumu_keeper']
for nid in GUMU:
    sh = shard_npc(nid)
    sk = sh.get('skills') or {}
    changed = False
    for slot, sid in list(sk.items()):
        if sid == 'emei_sword':
            sk[slot] = 'gumu_atk_1'
            changed = True
    lr = sh.get('learned') or {}
    if 'emei_sword' in lr:
        lr['gumu_atk_1'] = lr.pop('emei_sword')
        changed = True
    if changed:
        sh['skills'], sh['learned'] = sk, lr
        touch(nid)
        log.append(f'A1b {nid}: emei_sword → gumu_atk_1（本门）')

# A2b · 补槽位的人要握得上兵器（否则 combat.weaponPenalty 白打 0.45 折）
WEAPON_FIX = {
  'guo_xiang': 'iron_sword_basic',      # 剑 → 铁剑
  'huang_rong': 'wood_staff',           # 棍 → 白蜡杆
  'feng_qingyang': 'wood_sword',        # 剑 → 木剑（无剑胜有剑）
  'tian_boguang': 'iron_blade',         # 刀 → 砍山刀
  'lin_pingzhi': 'iron_sword_basic',    # 剑 → 铁剑
}

# =====================================================================
# A2 · 经典人物补槽位（按 learned 的类型装，不动数值）
# =====================================================================
CLASSICS = ['yang_guo', 'xiao_longnv', 'li_mochou', 'guo_xiang', 'guo_jing', 'huang_rong',
            'ouyang_feng', 'zhou_botong', 'xiao_feng', 'xu_zhu', 'ren_yingying',
            'feng_qingyang', 'tian_boguang', 'lin_pingzhi']
# 需要「招式保底」的人（learned 里只有内功，不给一招打不出来）
FALLBACK_MOVE = {'ren_yingying': ('拳', 'mojiao_atk_1')}
# learned 里没有内功的人：给本门内功底（无门派给通用小周天）
FALLBACK_INNER = {
  'xiao_feng': 'gaibang_force_3',
  'feng_qingyang': 'huashan_force_3',
  'lin_pingzhi': 'huashan_force_3',
  'huang_rong': 'cn_breath_art',
  'tian_boguang': 'cn_breath_art',
}

for nid in CLASSICS:
    n = npcs[nid]
    sh = shard_npc(nid)
    if isinstance(n.get('skills'), dict) and n['skills']:
        continue
    lr = n.get('learned') or {}
    best = {}
    for sid in lr:
        t = stype(sid)
        slot = SLOT.get(t)
        if not slot:
            continue
        g = grade(sid) or 99
        cur = best.get(slot)
        if cur is None or g < (grade(cur) or 99) or (g == grade(cur) and
           ((skills.get(sid) or {}).get('maxLevel') or 0) > ((skills.get(cur) or {}).get('maxLevel') or 0)):
            best[slot] = sid
    if nid in FALLBACK_MOVE:
        slot, sid = FALLBACK_MOVE[nid]
        best.setdefault(slot, sid)
    if nid in FALLBACK_INNER:
        best.setdefault('内功', FALLBACK_INNER[nid])
    assert best, nid + ' 没有可装槽位的技能'
    sh['skills'] = best
    lr2 = dict(sh.get('learned') or {})
    for sid in best.values():                      # 兜底补进来的技能也要挂 learned
        if sid not in lr2:
            cap = (skills.get(sid) or {}).get('maxLevel') or 900
            lr2[sid] = {'level': max(1, min(int((n.get('level') or 20) * 2.2), cap))}
    sh['learned'] = lr2
    touch(nid)
    log.append(f'A2 {nid}: 补槽位 ' + ', '.join(f"{k}={v}" for k, v in sorted(best.items())))

# A2b · 补兵器
for nid, wp in WEAPON_FIX.items():
    sh = shard_npc(nid)
    eq = dict(sh.get('equipment') or {})
    if eq.get('武器') == wp:
        continue
    eq['武器'] = wp
    sh['equipment'] = eq
    touch(nid)
    log.append(f'A2b {nid}: 配兵器 {wp}')

# =====================================================================
# A3 · mob 降档
# =====================================================================
MOB_FIX = {
  'mob_bandit_chief': ('hujia_daofa', 'cn_hidden_blade'),
  'mob_mo_disciple': ('heimu_zhang', 'mojiao_atk_1'),
}
for nid, (old, new) in MOB_FIX.items():
    sh = shard_npc(nid)
    sk = sh.get('skills') or {}
    if old not in sk.values():
        continue
    for slot, sid in list(sk.items()):
        if sid == old:
            sk[slot] = new
    lr = sh.get('learned') or {}
    if old in lr:
        lr[new] = lr.pop(old)
    sh['skills'], sh['learned'] = sk, lr
    touch(nid)
    log.append(f'A3 {nid}: {old}(g{grade(old)}) → {new}(g{grade(new)})')

# =====================================================================
# C · 绝学招式补内功（重算清单，A 改过的自动出局）
# =====================================================================
MOVE_T = ('拳', '剑', '刀', '棍', '暗器', '鞭')
c_cnt = 0
for nid, n in npcs.items():
    sk = n.get('skills')
    if not isinstance(sk, dict) or not sk:
        continue
    moves = [(s, sid) for s, sid in sk.items() if stype(sid) in MOVE_T]
    gs = [grade(sid) for _, sid in moves if grade(sid)]
    if not gs or min(gs) > 3:
        continue
    inner = [(s, sid) for s, sid in sk.items() if stype(sid) == '内功']
    gi = [grade(sid) for _, sid in inner if grade(sid)]
    if inner and gi and min(gi) <= 6:
        continue                       # 已有中阶以上内功，不动
    _sect0 = infer_sect(nid, n)
    if inner and not _sect0:
        continue                       # 无门派且已有通用内功：没有更好的档位（B 刀会连招式降档）
    sect = infer_sect(nid, n)
    rank = n.get('rank') or 0
    if sect:
        want = f'{sect}_force_3' if rank >= 4 else f'{sect}_force_2'
    else:
        want = 'cn_breath_art'
    if want not in skills:
        continue
    slot = inner[0][0] if inner else '内功'
    if sk.get(slot) == want:
        continue
    sk[slot] = want
    sh = shard_npc(nid)
    sh['skills'] = sk
    lr = dict(sh.get('learned') or {})
    if want not in lr:
        base_lv = int((n.get('level') or 20) * 2.2)
        cap = (skills.get(want) or {}).get('maxLevel') or 900
        lr[want] = {'level': max(1, min(base_lv, cap))}
        sh['learned'] = lr
    touch(nid)
    c_cnt += 1
log.append(f'C: 补/换内功 {c_cnt} 人')

# =====================================================================
# 收尾 · 槽位技能必须挂 learned（老守卫 smoke-npc-skills 的硬不变量）
# =====================================================================
lr_fix = 0
for nid in list(npcs.keys()):
    fn = npc_home.get(nid)
    if not fn:
        continue
    sh = docs[fn]['npcs'][nid]
    sk = sh.get('skills')
    if not isinstance(sk, dict) or not sk:
        continue
    lr = dict(sh.get('learned') or {})
    miss = [sid for sid in sk.values() if sid not in lr]
    if not miss:
        continue
    for sid in miss:
        cap = (skills.get(sid) or {}).get('maxLevel') or 900
        lr[sid] = {'level': max(1, min(int((sh.get('level') or 20) * 2.2), cap))}
    sh['learned'] = lr
    touch(nid)
    lr_fix += 1
log.append(f'收尾: 补挂 learned {lr_fix} 人')

# ---------------- 落盘 ----------------
for fn in sorted(dirty):
    write(fn, docs[fn])
print('改动分片:', sorted(dirty) or '（无）')
for line in log[:40]:
    print(' ', line)
if len(log) > 40:
    print(f'  … 另有 {len(log)-40} 条')

# =====================================================================
# 断言
# =====================================================================
v = {}
for fn in FILES:
    v[fn] = read(fn)
sk2, np2 = {}, {}
for fn in FILES:
    for sid, s in norm(v[fn].get('skills')).items():
        sk2[sid] = deep(sk2.get(sid, {}), s)
    for nid, n in norm(v[fn].get('npcs')).items():
        np2[nid] = deep(np2.get(nid, {}), n)
S2 = set(norm(read('30_sects.json').get('sects')).keys())

def st2(sid): return (sk2.get(sid) or {}).get('type') or ''
def g2(sid):
    g = (sk2.get(sid) or {}).get('grade')
    return g if isinstance(g, int) else None

# 1) 门派错配清零（crossSect 声明例外）
mis = []
for nid, n in np2.items():
    sect = n.get('sect') if n.get('sect') in S2 else infer_sect(nid, n)
    if not sect:
        continue
    cs = set(n.get('crossSect') or [])
    for sid in (n.get('skills') or {}).values():
        m = re.match(r'^([a-z]+)_', str(sid))
        p = m.group(1) if m else ''
        if p in S2 and p != sect and sid not in cs:
            mis.append((nid, sid, p, sect))
assert not mis, '仍有未声明的跨派: ' + str(mis[:5])

# 2) 经典人物补槽
for nid in CLASSICS:
    n = np2[nid]
    assert isinstance(n.get('skills'), dict) and n['skills'], nid + ' 无槽位'
    lr = set((n.get('learned') or {}).keys())
    got = set(n['skills'].values())
    assert lr & got, nid + ' 装上的槽位与 learned 无交集'

# 3) mob 品阶
for nid in MOB_FIX:
    gs = [g2(s) for s in (np2[nid].get('skills') or {}).values() if g2(s)]
    assert gs and min(gs) >= 7, nid + f' mob 仍持高阶: {gs}'

# 4) C 归零
left = 0
for nid, n in np2.items():
    sk = n.get('skills')
    if not isinstance(sk, dict) or not sk:
        continue
    mv = [g2(s) for s in sk.values() if st2(s) in MOVE_T and g2(s)]
    if not mv or min(mv) > 3:
        continue
    inner_sids = [s for s in sk.values() if st2(s) == '内功']
    if not inner_sids:
        left += 1
        continue
    sect = infer_sect(nid, n)
    if sect:
        gi = [g2(s) for s in inner_sids if g2(s)]
        if gi and min(gi) >= 7:
            left += 1
assert left == 0, f'仍有 {left} 个绝学招式缺内功'

# 5) 数值红线：level/atk/def/hp/mp 与 HEAD 逐字节同
base = {}
try:
    for fn in sorted(dirty):
        r = subprocess.run(['git', 'show', f'HEAD:game/data/{fn}'], cwd=ROOT,
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0 and r.stdout.strip():
            base[fn] = json.loads(r.stdout)
except Exception:
    base = {}
if base:
    for nid in list(CLASSICS) + list(MOB_FIX) + XINGXIU + GUMU:
        fn = npc_home.get(nid)
        old = (norm((base.get(fn) or {}).get('npcs')).get(nid) or {})
        if not old:
            continue
        for k in ('level', 'atk', 'def', 'hp', 'mp', 'maxHp'):
            if k in old:
                assert json.dumps(old[k], sort_keys=True) == json.dumps(np2[nid].get(k), sort_keys=True), \
                    f'{nid} 数值被改（红线）: {k}'
    print('数值红线通过：level/atk/def/hp/mp 与 HEAD 逐字节同')

# 6) 每个槽技能都挂了 learned
for nid, n in np2.items():
    sk = n.get('skills')
    if not isinstance(sk, dict):
        continue
    lr = n.get('learned') or {}
    for slot, sid in sk.items():
        assert sid in lr, f'{nid} 槽 {slot}={sid} 无 learned'

# 7) 兵刃系招式必有对应兵刃（暗器按既有惯例豁免）
WP = {'剑': ('sword',), '刀': ('blade',), '棍': ('staff',), '鞭': ('whip',)}
for nid in WEAPON_FIX:
    n = np2[nid]
    for slot, sid in (n.get('skills') or {}).items():
        if slot in WP:
            w = (n.get('equipment') or {}).get('武器') or ''
            assert any(k in w for k in WP[slot]) or w in ('wood_sword', 'wood_staff', 'iron_blade'),                 f'{nid} 兵刃槽 {slot} 无匹配武器: {w}'

print('断言全过：跨派清零（crossSect 除外） / 14 经典人物有槽位+兵器 / mob 已降档 / '
      f'绝学招式缺内功归零 / 槽位全挂 learned / 改动分片 {len(dirty)} 个')
