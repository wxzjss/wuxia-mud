# -*- coding: utf-8 -*-
"""画像钩子 trigger 修复 v2（2026-10-13）

【重新定性】
  出问题的钩子都是「后段钩子」——它们的 trigger 带一个正向 flag 条件，
  意思是「玩家做完前一件事之后，这件事才能问」。原设计是对的（阶段递进）。
  Bug 在于：那个 flag **名字写错了**，而同一件事的真实结局 flag 存在
  （命名规则：<hook_id>_<结局>）。写错的 → 后段钩子永远解不开。

【严格判定规则】
  对 trigger 里每个「正向引用且全库不存在」的 flag：
    key = flag 去掉 know_/met_/entered_/ 前缀 与 _done 后缀
    在同 NPC 的 hook id 家族里找真实 flag：
      真实 flag 名 以本 hook 的 id 前缀开头（如 hk_npcv_083_gaizi → hk_npcv_083_gaizi_clear）
      或 包含 key 且以 hk_ 开头（同 NPC）
    → 找到唯一 → 改名
    → 找不到 → 删该条件（降级为只留 trust）
"""
import json, io, os, glob, re

D = 'game/data'
RAWRES = re.compile(r'flag:([A-Za-z0-9_\u4e00-\u9fff]+)')

# ── 1. 收集真实 flag ──
SET = set()


def scan(o):
    if isinstance(o, dict):
        if (o.get('type') in ('flag', 'setflag')) and ('args' in o or 'arg' in o):
            a = o.get('args') or o.get('arg')
            for x in (a if isinstance(a, list) else [a]):
                if isinstance(x, str):
                    SET.add(x)
        for v in o.values():
            scan(v)
    elif isinstance(o, list):
        for v in o:
            scan(v)
    elif isinstance(o, str):
        for m in RAWRES.finditer(o):
            SET.add(m.group(1))


for fn in glob.glob(D + '/*.json'):
    try:
        d = json.load(io.open(fn, encoding='utf-8'))
    except Exception:
        continue
    scan(d)

# 手动台账（人工核对过的精确映射，优先级最高）
MANUAL = {
    'hk_npcv_083_gaizi': 'hk_npcv_083_gaizi_clear',
    'hk_npcv_126_tongxiang': 'hk_npcv_126_tongxiang_back',
    'hk_npcv_164_sirenzhang': 'hk_npcv_164_sirenzhang_expose',
    'hk_npcv_208_shaochuan': 'hk_npcv_208_shaochuan_report',
    'hk_npcv_215_mengming': 'hk_npcv_215_mengming_tell',
    'hk_npcv_223_laoxiapo': 'hk_npcv_223_laoxiapo_ack',
    'hk_npcv_240_shouyi': 'hk_npcv_240_shouyi_wear',
    'hk_npcv_248_changfu': 'hk_npcv_248_changfu_clear',
    'hk_npcv_181_guanliang': 'hk_npcv_181_guanliang_admit',
    'hk_npcv_154_suoyin': 'hk_npcv_154_maishen_free',
    'hk_npcv_174_zhangxin': 'hk_npcv_174_tuntang_report',
    'hk_npcv_009_shuoshu': 'hk_npcv_009_shuoshu_buy',
}


def resolve(hid, dead):
    """给定 hook id 与死 flag，返回要改成什么（或 None=删）"""
    if hid in MANUAL and MANUAL[hid] in SET:
        return MANUAL[hid]
    # 自动：找以本 hook id 开头的真实 flag
    cands = sorted(s for s in SET if s.startswith(hid + '_'))
    if cands:
        return cands[0]
    return None


report = []


def fix(o, hid, inNot=False):
    """返回 (新节点, 改动说明 或 None)"""
    if isinstance(o, dict):
        if (not inNot and isinstance(o.get('flag'), str) and o['flag'] not in SET
                and len(o) == 1):
            new = resolve(hid, o['flag'])
            if new:
                return {'flag': new}, ('remap', o['flag'], new)
            return None, ('drop', o['flag'], None)
        out = {}
        ch = None
        for k, v in o.items():
            if k == 'not':
                out[k] = v
                continue
            nv, e = fix(v, hid, inNot)
            if e and ch is None:
                ch = e
            if nv is not None:
                out[k] = nv
        return (out if out else None), ch
    if isinstance(o, list):
        kept = []
        ch = None
        for sub in o:
            nv, e = fix(sub, hid, inNot)
            if e and ch is None:
                ch = e
            if nv is not None:
                kept.append(nv)
        return (kept if kept else None), ch
    return o, None


def clean(tr, hid):
    if not isinstance(tr, dict):
        return tr, None
    for op in ('and', 'or'):
        if op in tr and isinstance(tr[op], list):
            kept = []
            ch = None
            for sub in tr[op]:
                nv, e = fix(sub, hid)
                if e and ch is None:
                    ch = e
                if nv is not None:
                    kept.append(nv)
            if not kept:
                return None, ch
            if len(kept) == 1:
                return kept[0], ch
            return {op: kept}, ch
    return fix(tr, hid)[0], None


def walk(o, src):
    if isinstance(o, dict):
        if 'trigger' in o and isinstance(o['trigger'], dict) and 'id' in o and 'title' in o:
            before = json.dumps(o['trigger'], ensure_ascii=False)
            new, ev = clean(o['trigger'], o['id'])
            if ev:
                after = json.dumps(new, ensure_ascii=False) if new else '(删除 trigger)'
                report.append((src, o['id'], o.get('title', ''), ev, before, after))
                if new is None:
                    del o['trigger']
                else:
                    o['trigger'] = new
        for v in o.values():
            walk(v, src)
    elif isinstance(o, list):
        for v in o:
            walk(v, src)


for fn in glob.glob(D + '/*.json'):
    try:
        d = json.load(io.open(fn, encoding='utf-8'))
    except Exception:
        continue
    src = os.path.basename(fn)
    n0 = len(report)
    walk(d, src)
    if len(report) > n0:
        io.open(fn, 'w', encoding='utf-8').write(
            json.dumps(d, ensure_ascii=False, indent=2) + '\n')

n_remap = sum(1 for r in report if r[3][0] == 'remap')
n_drop = sum(1 for r in report if r[3][0] == 'drop')
print('改动条数: %d  （改名 %d / 降级 %d）' % (len(report), n_remap, n_drop))
print()
for src, hid, title, ev, b, a in sorted(report):
    kind = '改名' if ev[0] == 'remap' else '降级'
    print('%-8s %-24s 【%s】' % (kind, hid, title))
    print('     %-22s → %s' % (ev[1], ev[2] or '(删除)'))
