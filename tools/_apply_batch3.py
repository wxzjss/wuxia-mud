# -*- coding: utf-8 -*-
"""批 3 落库：66 句去共用（家书13/你行了13/掌门11/比试11/守夜10/兄弟8）"""
import json

A_OLD = "家书压在枕头底下三个月了，没敢拆"
B_OLD = "求一句「你行了」，等了六年没等到"
C_OLD_T = "听说掌门要收新弟子，他把位置让给了师弟，自己守着旧摊子"
C_OLD_S = "听说掌门要收新弟子，她把位置让给了师弟，自己守着旧摊子"
D_OLD = "上个月比试输了半招，这一个月每天多练两个时辰"
E_OLD = "在崖上守夜，守了三年没跟人说过一句话"
F_OLD = "去年冬天走的那个兄弟，家里的钱还没送过去"

# A 家书 → portrait.now
A = {
 "sectguard_tangmen": "药棚底下收着一封信，火漆都验过三遍了，就是不拆。",
 "sectguard_kuaidao": "娘的信说入冬要添衣，赏钱还没攒够，看一眼心里堵一分。",
 "sectguard_dafeng": "船上的平安信压在箱底，自己识字慢，一封要看一晚上。",
 "disciple_tangmen_1": "家里问药铺的生意，写了三稿回信，都嫌假，还没寄。",
 "disciple_tangmen_2": "爹催婚的信又来了，压在枕下，回也不是不回也不是。",
 "disciple_jindao_1": "阿姐的信里夹了一缕头发，说家里都好，越说好越想家。",
 "disciple_tieqiang_0": "铺子捎来账本和一封信，账对完了，信还没敢翻。",
 "disciple_dafeng_0": "帮里驿船每旬一封家信，这一旬的没到，码头跑了两趟。",
 "disciple_wuliang_2": "娘托香客带的话到了，亲笔信还在八百里外。",
 "disciple_funiu_0": "山下猎户捎来口信说家里安好，话短，听着像隔了一层。",
 "disciple_funiu_1": "灶屋里熏黑的那封信看了四遍，落款的日期越看越旧。",
 "disciple_baisheng_0": "师姐替我念过一回信，之后就没敢再让人念。",
 "disciple_baisheng_2": "枕下那封信边角磨圆了，拆了封，还是没读到末行。",
}
# B 你行了 → portrait.want
B = {
 "sectguard_kuaidao": "就想听爹说一句「比当年强」，他不肯说，只好自己接着练。",
 "sectguard_wuliang": "师父从来只点头不夸人，想着哪天打得他非开口不可。",
 "disciple_tangmen_2": "唐门考核过了七回，就等祠堂里那声「可以了」。",
 "disciple_tangmen_3": "祖传的手艺差一窍，等叔父哪天肯把那一窍点给我。",
 "disciple_jindao_1": "出师那日想听师父说「站稳了」，这三个字攒了五年。",
 "disciple_wuhu_1": "师兄的眼神比师命还重，就想赢他一次，看他抬头。",
 "disciple_wuhu_2": "想着哪天娘来看我演武，看完肯当众说一声不亏。",
 "disciple_tieqiang_0": "铁匠行拜师那天师父说「看三年」，三年满了还没听到下文。",
 "disciple_tieqiang_2": "就想叫师父看我打完一整套锤，把烟杆从嘴上拿下来。",
 "disciple_kuaidao_2": "就等酒桌上师父肯替我满上那一杯。",
 "disciple_dafeng_1": "老船主说过「水性差一口气」，就差这口气，等他改口。",
 "disciple_wuliang_1": "师门年年考校，年年差一名次，等一回轮到我头名。",
 "disciple_baisheng_0": "师父说我「心思不在琴上」，想着哪天弹给她听，看她还怎么说。",
}
# C 掌门收徒让位 → portrait.now
C = {
 "sectguard_jindao": "新收的弟子分去了正屋，自己搬去柴房，铺盖一样没少带。",
 "sectguard_wuhu": "山门口的迎客活交给了新人，改守后山，清净不少。",
 "sectguard_tieqiang": "铺子交徒弟看着，自己退到后院打铁，火候反而比从前稳。",
 "disciple_tangmen_3": "库房的钥匙交了一半出去，另一半师弟还说拿不动。",
 "disciple_wuhu_0": "演武场上带新人，嗓子喊哑了，招还是那几招。",
 "disciple_tieqiang_1": "炉子让给了师弟，自己守着旧风箱，风比新的大。",
 "disciple_tieqiang_2": "收徒的名册上添了新人，念到我名字时位次往后挪了一行。",
 "disciple_kuaidao_0": "柜台让师弟站了，自己守着后堂那杆老秤。",
 "disciple_dafeng_1": "舵里的头把交椅让了出去，压舱的老规矩还归我管。",
 "disciple_dafeng_2": "新人顶了我的哨位，改巡夜路，夜里反倒看得更真。",
 "disciple_baisheng_1": "掌门身边的位子腾给了小师弟，茶还是我沏，火候没换人。",
}
# D 比试输了 → portrait.now
D = {
 "sectguard_wuliang": "上月校场输了半式枪，这月枪杆不离手，茧又厚了一层。",
 "sectguard_funiu": "比试输在三招之外，回来把那三招拆了又装，装了又拆。",
 "sectguard_baisheng": "输给同门半分力道，如今劈柴都数着数练。",
 "disciple_tangmen_0": "上月喂招输了半分，暗器匣里的飞蝗石多备了两成。",
 "disciple_jindao_0": "输的那半招输在腕上，如今每晚缠着沙袋睡。",
 "disciple_jindao_2": "同门点到我名字就叹气，等着下月校场换口气。",
 "disciple_wuhu_1": "输的是刀势收尾，这月收势练了两百遍，数还挂着。",
 "disciple_kuaidao_1": "上月差半步没近身，如今练的就是这半步。",
 "disciple_kuaidao_2": "输在对方回头那一眼太慢，看图谱看出个道理，还没练熟。",
 "disciple_wuliang_0": "师姐赢我那半招是家传的，想着用正路功夫赢回来。",
 "disciple_wuliang_1": "校场记名的册子上有我一场败绩，等着下月划掉它。",
}
# E 崖上守夜 → portrait.role
E = {
 "sectguard_miaojiang": "守着寨后那处崖口，夜里的虫鸣停了三回，人来了三回。",
 "sectguard_xuedao": "崖上风大，夜里守着守着，就学会了听雪落的声音。",
 "disciple_miaojiang_0": "巡崖三年，练出了听脚步辨人数的本事，最多一回听出五个。",
 "disciple_xingxiu_0": "守夜的功课做到第三年，佛珠数完了又数，心反倒静了。",
 "disciple_xingxiu_2": "崖下的云海三年看了上千回，每回的形状都不重样。",
 "disciple_xuedao_0": "崖上冷，守夜人换了一批又一批，我是留得最久的那个。",
 "disciple_xuedao_2": "三年守夜记满两本册子，全是风声兽踪，没一件大事。",
 "disciple_xuedao_3": "夜里守崖不许说话，话都攒到白天，攒多了也就不想说了。",
 "disciple_hehuan_3": "崖头那轮月看了三年，圆缺的日子比历书还熟。",
 "disciple_baituo_1": "守夜守出个习惯，睡着了耳朵也留一半在风里。",
}
# F 走了的兄弟 → portrait.now
F = {
 "sectguard_mojiao": "同棚的兄弟殁在去年冬天，抚恤的银子还在司里压着手续。",
 "disciple_miaojiang_0": "那位兄弟家里只有一个瞎眼的娘，银子迟迟不到，心里放不下。",
 "disciple_miaojiang_1": "兄弟的牌位还供在寨里，他家路远，银子托了三拨人都没送到。",
 "disciple_miaojiang_3": "兄弟留下的那把刀我替他磨着，磨得再亮也递不回他手里了。",
 "disciple_xingxiu_1": "给走了的师兄超度过三场，他家还欠着庙里的租，想着替还。",
 "disciple_xingxiu_3": "师兄走了半年，他那件棉袍还在房里挂着，没人敢动。",
 "disciple_xuedao_0": "兄弟的家在雪岭另一头，捎钱的路开了春才通，银子先凑齐了。",
 "disciple_xuedao_1": "兄弟临走托我看一眼他娘，凑的银子还差到家的那段脚钱。",
}

BAD = ["——", "不由得", "霎时间", "眼底闪过"]
allnew = list(A.values()) + list(B.values()) + list(C.values()) + list(D.values()) + list(E.values()) + list(F.values())
assert (len(A), len(B), len(C), len(D), len(E), len(F)) == (13, 13, 11, 11, 10, 8), "数量不对"
assert len(set(allnew)) == len(allnew), "批内有重复句"
for t in allnew:
    for b in BAD:
        assert b not in t, f"禁忌词 {b}: {t}"

d42 = json.load(open("game/data/42_sect_guards.json", encoding="utf-8"))
d43 = json.load(open("game/data/43_sect_disciples.json", encoding="utf-8"))
n42 = d42.get("npcs", d42)
n43 = d43.get("npcs", d43)

def get(pid):
    return n42[pid] if pid in n42 else n43[pid]

def put_now(pid, new):
    n = get(pid)
    assert "now" in n["portrait"], f"{pid} 无 now"
    n["portrait"]["now"] = new

def put_want(pid, new):
    n = get(pid)
    assert "want" in n["portrait"], f"{pid} 无 want"
    n["portrait"]["want"] = new

def put_role(pid, new):
    n = get(pid)
    assert "role" in n["portrait"], f"{pid} 无 role"
    n["portrait"]["role"] = new

for pid, new in A.items(): put_now(pid, new)
for pid, new in B.items(): put_want(pid, new)
for pid, new in C.items(): put_now(pid, new)
for pid, new in D.items(): put_now(pid, new)
for pid, new in E.items(): put_role(pid, new)
for pid, new in F.items(): put_now(pid, new)
# TSV 行7 未计入的存量：disciple_wuhu_2 的 now 是「她」变体，一并替换
WUHU2_NOW = "带新弟子的活分给了旁人，自己守着药圃的旧棚，藤架还是自己搭的那副。"
_n = get("disciple_wuhu_2")
assert _n["portrait"]["now"] in (C_OLD_S, WUHU2_NOW), f"wuhu_2 now 异常"
_n["portrait"]["now"] = WUHU2_NOW
# 另一处「她」变体：disciple_funiu_2（同样不在行7 清单内）
FUNIU2_NOW = "新弟子顶了我巡山的首班，自己改守末班，末班山道最静。"
_n = get("disciple_funiu_2")
assert _n["portrait"]["now"] in (C_OLD_S, FUNIU2_NOW), f"funiu_2 now 异常"
_n["portrait"]["now"] = FUNIU2_NOW

for path, d in (("game/data/42_sect_guards.json", d42),
                ("game/data/43_sect_disciples.json", d43)):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")

for path in ("game/data/42_sect_guards.json", "game/data/43_sect_disciples.json"):
    s = open(path, encoding="utf-8").read()
    for old in (A_OLD, B_OLD, C_OLD_T, C_OLD_S, D_OLD, E_OLD, F_OLD):
        assert old not in s, f"{path} 仍有旧句 {old}"
print("OK:", len(allnew))
