#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_spawn_polish.py —— 出生点清理（重击批第 1 件，游有方 2026-10-13）
----------------------------------------------------------------
主人真机反馈：「出生点几个 NPC 挤在一起（其中一个还是山贼）」。
数据侧实测归因（三条独立因果链，全实锤）：

① 山贼 = mob_bandit（40_npcs def，room=null 无定岗）
   respawn 挂 jm_underground（地下黑市，江南当铺地下）×2，noWander 缺失
   → 野地默认 20% 游走率 → jm_underground -上楼-> jn_pawnshop → 穿街
   → BFS 实测 6 步到 road_jiangnan_1 出生点。与 α 狼「丢定岗会游走」同病。
   修：104 补丁分片 noWander:true 钉住（respawn 定岗 jm_underground 不动）。

② 游侠 = demo_swordman——**官方示例 mod（mods/demo_quest/mod.json）的 NPC**，
   站 road_jiangnan_1「官道」（mod 写作时官道是普通路，act1 重做后成出生点）。
   modloader 默认逻辑 enabledByDefault !== false ⇒ **demo mods 默认全开**，
   示例 NPC 注入玩家主世界。77/86/87/91 四基础分片还给它打了字段补丁
   （skills/mp/personality/carry——demo 开着时仍生效，保留不动）。
   修：全部 demo mods 的 mod.json 加 enabledByDefault:false（示例是给 Mod
   作者参考的，玩家默认不该见到；想看示例手动开）。

③ 老周 = cy_pre_teaman（98_mainline_expansion 城市案 NPC，tier C），
   room 错挂 road_jiangnan_1（城外出生点）。M3 口径「锁区即锁案」——
   人应随案进城。修：room → jiangnan_street（认痕前城门锁着，出生点不见他）。

验证：boot+newGame 后出生点 view.npcs 只剩 guide_teaman（卖茶的老汉，
接信链核心）。demo-mods-check / npc-skills 等判据复跑确认无连带。
"""
import json, os, io, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)


def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
# ---------- ① mob_bandit noWander（新分片 104，深合并补丁） ----------
P104 = os.path.join(ROOT, 'game', 'data', '104_birth_polish.json')
d104 = read(P104) if os.path.exists(P104) else {"_note": ""}
d104.setdefault('npcs', {})
d104['npcs']['mob_bandit'] = {"id": "mob_bandit", "noWander": True}
d104['_note'] = ("出生点清理承接片（重击批，design/101，2026-10-13 游有方）："
                 "mob_bandit noWander 钉住地下黑市（respawn 定岗不动，防 20% 野地游走率"
                 "经 jn_pawnshop 漂到出生点——与 α 狼同病，BFS 实测 6 步可达）。"
                 "另两件不走本片：demo mods 默认关（改 mods/*/mod.json）、"
                 "cy_pre_teaman 进城（改 98 分片）。")
write(P104, d104)
print('OK: 104_birth_polish.json mob_bandit noWander=true')

# ---------- ② demo mods 默认关 ----------
for mp in sorted(glob.glob(os.path.join(ROOT, 'mods', 'demo_*', 'mod.json'))):
    m = read(mp)
    if m.get('enabledByDefault') is False:
        print('OK（已关，跳过）:', m['id'])
        continue
    m['enabledByDefault'] = False
    write(mp, m)
    print('OK: mods/%s/mod.json enabledByDefault=false' % m['id'])

# ---------- ③ 老周进城 ----------
P98 = os.path.join(ROOT, 'game', 'data', '98_mainline_expansion.json')
d98 = read(P98)
zhou = d98['npcs']['cy_pre_teaman']
if zhou.get('room') == 'jiangnan_street':
    print('OK（已进城，跳过）: cy_pre_teaman')
else:
    assert zhou.get('room') == 'road_jiangnan_1', '老周 room 意外值: %r' % zhou.get('room')
    zhou['room'] = 'jiangnan_street'
    write(P98, d98)
    print('OK: 98 cy_pre_teaman room road_jiangnan_1 -> jiangnan_street')

print('出生点清理三件完成。')
