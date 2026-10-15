#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_auction_hooks.py —— 拍卖场景化三件套·件①市集房动作（游有方，2026-10-14）
--------------------------------------------------------------------------------
design/103 快捷栏审计的配套落盘：拍卖常驻快捷钮已撤，给六城拍卖行所在市集
各挂 1 个**常驻房动作**「逛拍卖行」——玩家走到市集，房卡上自然看得见，
这就是 103 判据说的「在某个地块时自然而然就知道」。

六房（50_map 本体，75_content_extra 的薄 def 只带 auctionHouse 标记不动）：
  luoyang_market 洛阳城·南市 / changan_market 长安城·西市 / chengdu_market 成都府·蜀锦市
  xiangyang_market 襄阳城·马市 / jiangnan_market 江南城·市集 / gusu_town 姑苏城外

选词纪律（questKeyword 撞车教训，_apply_j2b_seg2 实测）：
  · cmd 统一「逛拍卖行」，keywords ['拍品','看拍','逛拍卖行']——**不收「拍卖」
    与「拍卖行」全词**：那是全局指令（commands.js reg ['auction','拍卖','拍卖行']）
    的正主，市集里敲「拍卖」要直达拍品面板，不能被房动作抢先吃成一句指路话；
  · 房动作只做「看见+勾一眼」的引导，真入口仍是全局指令与前端面板；
  · 各房既有动作条目逐字不动（append 不替换）。

文案：六城六写，各接本城 desc 现有物象（洛阳洛水/长安胡商/成都锦缎/襄阳马市/
江南幌子/姑苏桥头）；红线自查：无破折号 / 无旁白对偶 / 无朱雀偏好词。

幂等：已落则跳过。改完复验 _zhuque_per_asset 六房 ≤10 + ai-flavor + map-check。
"""
import json, io, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')


def read(p):
    return json.load(io.open(p, encoding='utf-8'))


def write(p, d):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')


# 六城六写：场景一句 + 出路一句（出路句统一点破「拍卖」主入口词）
ACTIONS = {
    'luoyang_market':
        '南市街心一座两层门脸，檐下金字招牌被香火熏得发暗。柜上朝奉拨着算盘核账，'
        '算珠响得又急又稳。他抬眼扫你一下：「看货寄货，道声『拍卖』。」',
    'changan_market':
        '西市深处一间驼队栈房改的铺面，门口拴马桩上还缠着旧毛毡。当柜的老者高鼻深目，'
        '一口官话带着胡音。他拍拍柜面：「拍品都在后堂架子上，说声『拍卖』就带你开眼。」',
    'chengdu_market':
        '蜀锦市尽头一间铺子，门脸不宽，进深却长，柜上挂着一面开拍用的小锣。'
        '朝奉嗑着瓜子招呼客人：「锦缎古玩都有得拍，说声『拍卖』。」',
    'xiangyang_market':
        '马市北头一间石墙敞棚，原是牲口行喊价的地方，木架上还搭着几副旧鞍。'
        '柜上管事嗓门大，招呼只一句：「看货寄货，说『拍卖』。」',
    'jiangnan_market':
        '那面「货真价实」的幌子旁边，还挑着一面窄幡，写的是「公买公卖」。'
        '幡下柜台上压着一面小铜锣。朝奉说这里三日一开拍，看货寄货，道声「拍卖」就行。',
    'gusu_town':
        '桥头往南数第三家门面，不挂幌子，只在柜上压着一方旧砚。看铺的老者说，'
        '城里人寄卖的稀罕物都打这里过手；要看货，道一声「拍卖」。',
}
ROOMS = list(ACTIONS.keys())
CMD = '逛拍卖行'
KWS = ['拍品', '看拍', '逛拍卖行']

d50 = read(P50)
dirty = False
for rid in ROOMS:
    room = d50['rooms'].get(rid)
    assert room is not None, rid + ' 不在 50_map'
    acts = room.setdefault('actions', [])
    if any(a.get('cmd') == CMD for a in acts):
        print(f"OK（已落，跳过）: {rid}")
        continue
    acts.append({
        "cmd": CMD,
        "label": "逛拍卖行",
        "keywords": list(KWS),
        "desc": "看看柜上在收什么拍什么",
        "effects": [{"type": "narrate", "raw": ACTIONS[rid]}],
    })
    dirty = True
    print(f"OK: {rid} 挂「{CMD}」房动作")

if dirty:
    write(P50, d50)
    print('OK: 50_map（六城拍卖行房动作）')
else:
    print('OK（全部已落，跳过）: 50_map')

# ---------------- 断言（重读盘面） ----------------
v50 = read(P50)
for rid in ROOMS:
    acts = v50['rooms'][rid].get('actions') or []
    hit = [a for a in acts if a.get('cmd') == CMD]
    assert len(hit) == 1, rid + ' 房动作数量不对'
    a = hit[0]
    assert a['label'] == '逛拍卖行' and a['keywords'] == KWS, rid + ' 选词被动'
    assert not a.get('cond') and not a.get('once'), rid + ' 常驻动作不该带 cond/once'
    raw = a['effects'][0]['raw']
    assert '拍卖' in raw, rid + ' 出路句没点破主入口词'
    assert '——' not in raw, rid + ' 破折号混入'

# 原有条目未被挤掉（批4 指路钩子仍在）
old = [a for a in v50['rooms']['jiangnan_market']['actions'] if a.get('cmd') == '看当铺告帖']
assert len(old) == 1, '江南市集原「看当铺告帖」动作被挤掉'

# 选词纪律：全库任何房的房动作 cmd/keywords 不与新选词撞（questKeyword 纪律）
NEW_WORDS = {CMD} | set(KWS)
for rid, room in v50['rooms'].items():
    for a in (room.get('actions') or []):
        if a.get('cmd') == CMD and rid in ROOMS:
            continue
        words = {a.get('cmd', '')} | set(a.get('keywords') or [])
        clash = NEW_WORDS & {w for w in words if w}
        assert not clash, f"{rid} 房动作撞词: {clash}"

# 全局指令词「拍卖/拍卖行」不在新动作 keywords 里（防抢吃主入口）
assert '拍卖' not in KWS and '拍卖行' not in KWS, 'keywords 撞全局指令主词'

print('断言全过：六房各 1 条常驻房动作 / 选词不撞 / 原条目保留 / 无破折号')
