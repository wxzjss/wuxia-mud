# -*- coding: utf-8 -*-
"""批 2 落库：76 句去共用（40 talk + 19 portrait.want + 17 portrait.now）"""
import json, sys

TALK_OLD = "「师兄抄书去了？茶还温着。」"
WANT_OLD = "盼着哪天能跟师兄下山，去看一眼真正的大漠"
NOW_OLD = "上个月家里来信，说弟弟染了病，钱还寄不回去"

TALK = {
 "disciple_huashan_0": "「剑坪的落叶没人扫，我扫到东头，西头又落满了。」",
 "disciple_huashan_2": "「后山那片竹林今早伐了一批，账还没对完。」",
 "disciple_huashan_4": "「厨房说晚上的馍不够，得再蒸两屉。」",
 "disciple_shaolin_0": "「藏经阁今日轮我值守，香客借书得先登记。」",
 "disciple_shaolin_2": "「早课迟了半刻，罚挑水二十担，挑完这担就能歇。」",
 "disciple_shaolin_4": "「药圃的金银花该收了，再拖就要落尽。」",
 "disciple_wudang_0": "「打坐的蒲团旧了，换新的得下山去购。」",
 "disciple_wudang_2": "「师弟的剑谱抄错了两页，得重抄。」",
 "disciple_wudang_4": "「殿前的香灰今早才清，又有香客上了三炷。」",
 "disciple_emei_0": "「绣了一半的经盖搁在案上，等晚课完了再动针。」",
 "disciple_emei_2": "「山门外积雪没化，柴房的柴得省着烧。」",
 "disciple_emei_4": "「师姐的功课替我看着些，我去山下抓药。」",
 "disciple_gaibang_0": "「昨夜分舵那边递了话，说城里有几个新面孔要盯。」",
 "disciple_gaibang_2": "「讨来的馒头分了一半给巷尾的瞎眼老汉。」",
 "disciple_gaibang_4": "「打狗棒法第四式我总差半分劲，得再琢磨。」",
 "disciple_dali_0": "「段家马厩今早少了匹马，去看过，是自己跑出去的。」",
 "disciple_dali_2": "「寺后的茶树发芽了，采头一茬得趁这几天。」",
 "disciple_dali_4": "「经书晒了一上午，收晚了就潮了。」",
 "disciple_tangmen_0": "「新配的一炉药引火候过了，倒了重炼。」",
 "disciple_tangmen_2": "「试毒的银针每日都得换，换下来的收在匣里。」",
 "disciple_gumu_0": "「琴弦断了一根，山下才有卖的，得托人捎。」",
 "disciple_gumu_2": "「这一遍功练完，手上还得捂半个时辰才回暖。」",
 "disciple_taishan_0": "「十八盘的台阶又冻了，上去的香客滑倒两个。」",
 "disciple_taishan_2": "「师叔说我的斧劈功夫还欠火候，让我先劈一个月柴。」",
 "disciple_hengshan_0": "「庵里的晚课结束了，得去把山门闩上。」",
 "disciple_hengshan_2": "「今日山下有人送来一筐杏，分了半筐给厨房。」",
 "disciple_hengshanN_0": "「大殿的烛台擦完了，还差供桌没抹。」",
 "disciple_hengshanN_2": "「师姐让我看着炉子，药煎糊了要挨说的。」",
 "disciple_qingcheng_0": "「山道滑，昨儿一位师弟下坡摔了跟头。」",
 "disciple_qingcheng_2": "「茶炉上的水开了半晌，师兄还没回来。」",
 "disciple_kongtong_0": "「早课的钟是我敲的，敲早了被师祖说了一顿。」",
 "disciple_kongtong_2": "「山上的雪水接了满满一缸，够用三天。」",
 "disciple_kunlun_0": "「山口的风一夜没停，哨位上换了三班人。」",
 "disciple_kunlun_2": "「檐下的干肉冻硬了，得拿进来回回温。」",
 "disciple_diancang_0": "「库房的灯油记好了数，月底要对账。」",
 "disciple_diancang_2": "「演武场的木桩换了两根新的，钉子还松着。」",
 "disciple_wuyun_0": "「雾大，练剑的师兄们收了式还在雾里走。」",
 "disciple_wuyun_2": "「柴担从后山挑回来，肩上磨出个印子。」",
 "disciple_dafeng_0": "「帮里规矩，新入伙的先守三日大门，我守完了。」",
 "disciple_dafeng_2": "「船帮今日靠岸七条船，货单还没核完。」",
}

WANT = {
 "sectguard_wuyun": "攒够盘缠就辞了这份差，回滇南看看阿妈种的茶树。",
 "disciple_gumu_2": "想把后山那条暗河走到头，看看它流进哪条江里。",
 "disciple_taishan_0": "想去山下镇上看一场社戏，从小只听过戏文里的调子。",
 "disciple_taishan_2": "等武艺练成，想押一趟镖走趟远路，见识见识关外。",
 "disciple_taishan_3": "想着哪天能把山顶的日出画下来，带给我娘看。",
 "disciple_hengshan_0": "盼着下山办一趟差，顺路去衡阳城买把好伞。",
 "disciple_hengshan_1": "想去看一次海，书上说的潮声，不知比不比得上山里松涛。",
 "disciple_hengshanN_0": "等这身功夫练扎实了，想回家给爹的坟头磕个头。",
 "disciple_hengshanN_3": "想着哪天卸了守夜的差，去北边看看雪原上跑的马群。",
 "disciple_qingcheng_1": "想去蜀中看一次织锦，师父说那颜色比晚霞还多几层。",
 "disciple_qingcheng_2": "攒着俸钱呢，想买匹好马，骑回山后那条老路。",
 "disciple_qingcheng_3": "想着下山一趟，尝尝镇口那家豆花是不是还是老味道。",
 "disciple_kongtong_0": "想把山后那三道险峡都走一遍，听说没人走到过底。",
 "disciple_kongtong_1": "想着哪天把山下集市逛个遍，给师妹捎根红头绳。",
 "disciple_kunlun_1": "想着哪年开春能护送香客下山，一路上看看关内的春色。",
 "disciple_diancang_0": "想去看一眼洱海，师姐说月亮掉进水里也不碎。",
 "disciple_diancang_2": "想着哪天镖行缺人，跟着走一趟茶马道，长长见识。",
 "disciple_luohan_1": "想学师姐们下山化缘，走一走山门外那条官道。",
 "disciple_wuyun_0": "盼着哪天雾散得透，能看全山脚下那片梯田。",
}

NOW = {
 "disciple_diancang_2": "前日库房盘账短了两百文，自己垫上了，没敢声张。",
 "disciple_gumu_1": "练功时左肩总差半寸到位，师姐说我心里搁着事。",
 "disciple_gumu_2": "夜里总睡不沉，天不亮就醒了，索性起来练剑。",
 "disciple_hengshanN_0": "昨夜巡山漏了一班，被值月的记了一笔。",
 "disciple_hengshanN_1": "师门的功课落了两天，赶是能赶上，就是得少睡。",
 "disciple_hengshan_0": "山下张屠户托人捎话，说家里的老狗不行了。",
 "disciple_hengshan_2": "上月寄回去的银子还没个回音，怕是路上出了岔子。",
 "disciple_kongtong_3": "同门比试连输三场，掌法改了三遍，还是不得劲。",
 "disciple_kunlun_0": "巡山回来冻了半夜，咳到今早还没好利索。",
 "disciple_kunlun_1": "二弟来信要成亲了，礼钱得从月例里再省三个月。",
 "disciple_kunlun_3": "爹的腿伤又犯了，家里捎信想借二十两，还没想好怎么回。",
 "disciple_qingcheng_3": "绣帕上的并蒂莲拆了三回，总觉得针脚不如师姐的稳。",
 "disciple_taishan_1": "师娘捎来的棉衣小了一码，凑合着又穿了一冬。",
 "disciple_taishan_3": "家里的地典给了人，赎回来的日子还没个准数。",
 "sectguard_hengshan": "守门的活计清闲，闲下来反倒睡不踏实。",
 "sectguard_qingcheng": "儿子该开蒙了，束脩还差着一大截没凑齐。",
 "sectguard_kongtong": "夜里山风大，守到三更就冷得跺脚。",
}

# 断言一：禁忌词 + 全批唯一性
BAD = ["——", "不由得", "霎时间", "眼底闪过"]
allnew = list(TALK.values()) + list(WANT.values()) + list(NOW.values())
assert len(TALK) == 40 and len(WANT) == 19 and len(NOW) == 17, "数量不对"
assert len(set(allnew)) == len(allnew), "批内有重复句"
for t in allnew:
    for b in BAD:
        assert b not in t, f"禁忌词 {b}: {t}"

d42 = json.load(open("game/data/42_sect_guards.json", encoding="utf-8"))
d43 = json.load(open("game/data/43_sect_disciples.json", encoding="utf-8"))
n42 = d42.get("npcs", d42)
n43 = d43.get("npcs", d43)

n_talk = n_want = n_now = 0
for pid, new in TALK.items():
    talk = n43[pid]["talk"]
    assert talk[1] in (TALK_OLD, new), f"{pid} talk[1] 异常: {talk[1]}"
    talk[1] = new
    n_talk += 1
for pid, new in WANT.items():
    src = n42 if pid in n42 else n43
    assert "want" in src[pid]["portrait"], f"{pid} 无 want"
    src[pid]["portrait"]["want"] = new
    n_want += 1
for pid, new in NOW.items():
    src = n42 if pid in n42 else n43
    assert "now" in src[pid]["portrait"], f"{pid} 无 now"
    src[pid]["portrait"]["now"] = new
    n_now += 1
assert (n_talk, n_want, n_now) == (40, 19, 17)

for path, d, indent in (("game/data/42_sect_guards.json", d42, 1),
                        ("game/data/43_sect_disciples.json", d43, 1)):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(d, ensure_ascii=False, indent=indent) + "\n")

# 断言二：旧句清零
for path in ("game/data/42_sect_guards.json", "game/data/43_sect_disciples.json"):
    s = open(path, encoding="utf-8").read()
    for old in (TALK_OLD, WANT_OLD, NOW_OLD):
        assert old not in s, f"{path} 仍有旧句 {old}"
print(f"OK: talk {n_talk} / want {n_want} / now {n_now} = {n_talk+n_want+n_now}")
