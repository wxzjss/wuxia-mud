# -*- coding: utf-8 -*-
"""三关前置断言：gender 与代词一致性。
扫描 42/43 全部 NPC：female 不许出现「他/汉子/小伙」，male 不许出现「她/姑娘」。
用法：python tools/_check_gender_pronoun.py   （红=exit 1）
"""
import json, sys

BAD = {"female": ["他", "汉子", "小伙"], "male": ["她", "姑娘"]}

def fields(n):
    # 只扫自述字段（描述 NPC 本人的）；talk 是对玩家说话，可合法提到第三者，不扫
    p = n.get("portrait") or {}
    for k in ("role", "now", "want", "origin", "fear", "arc"):
        if isinstance(p.get(k), str):
            yield "portrait." + k, p[k]
    if isinstance(n.get("desc"), str):
        yield "desc", n["desc"]

total = 0
for path in ("game/data/42_sect_guards.json", "game/data/43_sect_disciples.json"):
    d = json.load(open(path, encoding="utf-8"))
    npcs = d.get("npcs", d)
    for pid, n in npcs.items():
        if pid.startswith("_"):
            continue
        g = n.get("gender")
        if g not in BAD:
            continue
        for where, t in fields(n):
            for w in BAD[g]:
                if w in t:
                    total += 1
                    print(f"RED {path} {pid} [{g}] {where}: 「{w}」in {t[:50]}")
if total:
    print(f"FAIL: {total} 处代词不一致")
    sys.exit(1)
print("OK: 42/43 代词一致性 0 红")
