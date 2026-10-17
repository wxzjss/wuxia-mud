#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_act3_map.py —— 批 2「地图步+卷三第一批」data 侧（design/100，游有方 2026-10-13）
----------------------------------------------------------------
lead 口令：闸门文案+三区地标+行路边（93 口径三件套，朱雀 ≤10）。
本脚本落 data 分片（门对象/房/行路边——act1 六门先例，引擎呈现归寇豆码）：

① F5 六处闸门（cond act2_done，93 口径 say/msg/travel）——六套文案朱雀
   全 ≤5（say/travel），说话人逐处身份咬合（戍堡老卒/青盐贩子/商队保头/
   茶棚老汉/守祠老妪/出关书办）；road_many_1 双向两套。
   2026-10-15 扫尾④补第七处：road_beijiang_1.w 出北疆进荒原保头戏
   （road_many_1.e 闸门的严格反向——原版对边被首版 BACK_LINKS 压掉）。
② F6-a luoyang↔mojiao 边改挂 beijiang（原边把卷二收束玩家送进黑木崖）；
   F6-b regions.entry：beijiang 改挂 road_beijiang_1（原挂血刀门大殿=行路
   空降门派）；新增行路边 luoyang↔beijiang（cond act2_done，93 §二老船工
   文案现成）。
③ F7 jiangnan_east_road.s→mojiao_shanmen 废边删除。
④ 三区地标房 12 间（desc/talk 全新写，朱雀 ≤5；每区 4 间功能房）+ exits
   接线（新房连既有房，回边同步）。
幂等：内容比对，两连跑 OK。
"""
import json, os, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

COND = {"flag": "act2_done"}

GATES = {
    ("road_nan_1", "w"): {
        "to": "road_beijiang_1", "cond": COND,
        "say": "「站住。墩台换防，过所押在堡里，这两天不放人北上。」他往火盆里添了把柴，「兵过完再走。兵没过完，路上见着的就不是行商了。」",
        "msg": "戍堡的兵横枪拦路，说这两天不放人北上。",
        "travel": "老卒翻了翻册子，在过所上画了个押。「过了墩台别歇脚，一口气走到黑水驿。天黑前那一段路上没有人。」",
    },
    ("road_gaibang_1", "e"): {
        "to": "road_xixia_1", "cond": COND,
        "say": "赶骡子的人坐在道边石头上，没起身。「这条道现在不通买卖。西夏的青盐进不来，中原的布出不去，路上走的都是传信的马。」他拍了拍骡子的背，「你要不是传信的，就再等等。盐路一通，我头一个知道。」",
        "msg": "贩盐的老客摇头，说这条道现在不通买卖。",
        "travel": "「盐路开了？」他站起来，拍了拍土。「那你跟着我的骡子走，走骡子走的道，别抄近路。近路上个月还埋着两个人。」",
    },
    ("road_many_1", "e"): {
        "to": "road_beijiang_1", "cond": COND,
        "say": "保头把烟锅在鞋底磕了磕。「荒原上没有路，只有水。你知道下一个水头在哪，你就有路；不知道，你走的就是死路。」他用烟锅指了指南边，「商队五天后还有一趟。跟着队尾走，别走前头。前头是探路的。」",
        "msg": "商队保头说荒原不单放人，得跟队走。",
        "travel": "保头把你排在队尾，塞给你一只皮囊。「省着喝。荒原上水比命长。夜里听见狼叫别动窝，它们不攻有火的人。」",
    },
    ("road_many_1", "w"): {
        "to": "road_xiyu_1", "cond": COND,
        "say": "地窨子外头挂着半旧的幌子。老汉往炉子里塞了把干粪。「西口这段，晌午前后走人。这会儿日头偏了，风一起，沙子打在脸上跟刀子似的。」他从水缸里舀了瓢水推过来，「喝了再走。水是白给的，命是自己的。」",
        "msg": "茶棚老汉说日头偏了，这段路这个时辰不放人。",
        "travel": "你喝了水。老汉收了瓢，往西指了指。「看见那棵死胡杨没有？朝着它走，走到它跟前再找下一个。荒原上就是这么走的。」",
    },
    ("jinguo_ruin", "n"): {
        "to": "road_beijiang_1", "cond": COND,
        "say": "废祠门口坐着一个老妪，在搓草绳。她没抬头。「祠里供的已经不是你们的神了。北边去的人，先说清楚自己是谁家的。」她把搓好的草绳绕上手腕，「三十年了，从这门口过去的兵，没几个回来。你要去，先留下个名字。我不问来路。名字留下了，祠里知道该给谁上香。」",
        "msg": "守祠的老妪拦在门口，要先留个名字才放行。",
        "travel": "你说了名字。老妪点点头，把草绳的一头递给你。「拿着。北边风大，缠在手腕上，迷了方向就顺着风走。祠里搓的，比马缨结实。」",
    },
    ("changan_gate", "s"): {
        "to": "road_xiyu_1", "cond": COND,
        "say": "书办把册子推过来，指了指末行的空格。「出关要画押，画押要通名。西边不比中原，出了玉门，官府的册子就够不着你了。」他蘸了墨等着，「名字写清楚。写清楚了，出了事，家里还能收到个信。」",
        "msg": "书办合上册子，说出关画押的名册这几天不办。",
        "travel": "书办画了押，把册子收进匣子，上了锁。「出了西门，官道走三天，第三天傍晚有个烽燧，烽燧底下能宿夜。再往西，就没有官道了。」",
    },
    # 2026-10-15 扫尾④：road_beijiang_1.w 出北疆进荒原保头戏（93 口径三件套）。
    # git 原版此向对边=road_many_1，批 2 BACK_LINKS 无条件赋值把它压成黑水驿——
    # 现恢复为对 road_many_1.e 闸门的严格反向（对象对对象，保头同一人反向戏）。
    ("road_beijiang_1", "w"): {
        "to": "road_many_1", "cond": COND,
        "say": "界碑底下蹲着个喂马的保头，看了你一眼。「北边待不住了吧。」他把最后一捧料倒进槽里，「回去也一个规矩：跟队。商队回程五天后，你要等就等。等不及的，先跟这条道上随便谁说一声去哪儿。荒原收人，先收不吭声的。」",
        "msg": "界碑旁的保头说出荒原必须跟队，一个人不放。",
        "travel": "保头把你的名字记在队尾货单的背面。「记上了，走丢了前后好找。头一个水头之前别动水囊里的水，忍着。忍到的人才有第二个水头。」",
    },
}

# 地标房：id -> (name, region, desc, talk, exits)
LANDMARKS = {
    "beijiang_hunting_hut": ("雪谷外围·猎户冬屋", "beijiang",
        "半截埋在雪里的木屋，烟囱歪着。屋檐下挂着一排剥好的貂皮，冻得硬邦邦的，风一吹互相磕碰，响得像木板。门口雪地里插着一张弓，弓弦上了油。",
        ["「皮子要就现在挑。开春雪一化，虫就上来了。」", "「雪谷里最近有生人走动，脚印比我的靴子大两码。你要进谷，白天进，天黑前出来。」"],
        {"s": "beijiang_shankou"}),
    "beijiang_market": ("血刀山·冻市", "beijiang",
        "冻市。摊子搭在雪地上，卖的都是压秤的东西：铁器、皮子、腌肉、烈酒。买主和卖主都戴着手套，讲价的时候把手指头伸出来比，不张嘴。天太冷，张嘴呵出的气白费。",
        ["「酒是热的。在这儿摆摊，酒不热没人买。」", "「铁器看清楚了再给钱。出了这个市，血刀门的规矩就是规矩了。」"],
        {"e": "beijiang_xuedao"}),
    "beijiang_yizhan": ("北路尽头·黑水驿", "beijiang",
        "官道到这儿就到头了，再往北没有官道。马厩里两匹马，都是驮炭的。柜台后头钉着一块木板，写满了名字和日子，过路人报平安用的。",
        ["「北边没有驿了。你的信写到我这儿为止。」", "「要在木板上留名字，自己写。字丑不怕，怕的是家里人认不出。」"],
        {"se": "road_beijiang_1"}),
    "beijiang_lookout": ("望雪台", "beijiang",
        "一块凸出的岩台，正对雪谷。天气好的时候能看见谷口的哨卡，旗子是灰的。岩台上钉着一排木桩，桩上拴着褪色的红布条，一条一条，都是过路人求平安留下的。台边风大，站一会儿，眉毛上就是霜。",
        ["「数布条没用。数得过来的都回来了，回不来的没人来数。」"],
        {"n": "beijiang_shankou"}),
    "xiyu_bazaar": ("疏勒·巴扎", "xiyu",
        "绿洲上的集市，棚布五颜六色，风一过整片市集哗啦响。卖玉的、卖毯的、卖料器的挤在一处，中间留出一条道过驼队。空气里是孜然、皮革和牲口的味道，混在一起，热烘烘的。",
        ["「毯子分三种：赶驼人用的、娶亲用的、陪葬用的。你要哪种，价钱差三倍。」", "「星宿海的人也来赶集。他们买什么我不说，说了你晚上睡不着。」"],
        {"w": "xiyu_shule"}),
    "xiyu_caravanserai": ("驼队客栈", "xiyu",
        "一圈土坯房围出来的院子，能容六支驼队。院里一口深井，井沿被绳子磨出十几道槽。客房没有门板，挂毯子当门。夜里院中点一堆火，火不灭，客人就不散。",
        ["「床位按夜算，草料按捆算，水按瓢算。都便宜，就一样贵：火。夜里想单独点火的，先跟掌柜的说。」", "「往东的驼队三天一趟。赶巧了今晚就有，跟队头打个招呼就行。」"],
        {"n": "xiyu_oasis"}),
    "xiyu_herb_hut": ("星宿海·药庐", "xiyu",
        "芦苇滩上的一座高架小屋，离地六尺，防潮也防兽。屋外晾着一排竹匾，匾里的东西有的像花，有的像虫壳，有一匾是空的，匾底写着两个字：勿动。",
        ["「药材认人。你手上有没有旧伤，一闻就知道能不能碰我这些匾。」", "「别问空匾那味药。上回问的人，现在还在星宿海里替我试新方子。」"],
        {"e": "xiyu_xingxiu"}),
    "xiyu_well": ("古井亭", "xiyu",
        "半塌的亭子罩着一口井，井栏上的刻字被摸得发亮，认不出字了。往下看，井水极深极静，投一颗石子，好一会儿才有一声轻响。亭柱上拴着红绳，绳子旧了，没人敢换。",
        ["「许愿的把红绳拴柱上，取水的只管打水。两不耽误。」", "「这井旱年没干过，涝年没满过。本地人说不清为什么，也就不说了。」"],
        {"se": "xiyu_oasis"}),
    "xixia_salt_shed": ("盐池·工棚", "xixia",
        "盐池边一排矮棚，棚柱被盐卤蚀得发白。工棚里堆着盐耙和木斗，墙角一杆秤，秤砣是块石头。空气又咸又呛，待久了嘴唇发麻。棚外几个盐工弯着腰，影子被日头钉在盐田里。",
        ["「盐册三天记一回账。账上多出来的，谁也不敢问。」", "「想见管事的，先等他骂完人。骂完那天他心情好。」"],
        {"w": "xixia_yanchang"}),
    "xixia_market": ("兴庆·集市", "xixia",
        "王城外的大集，摊位按行当排，卖皮毛的在东头，卖铁器的在西头，中间是吃食。人声里夹着党项话和汉话，讨价还价都是两套词。集口支着一杆大秤，据说是官府验货用的，秤星是金的。",
        ["「西头的铁器别碰。那是军市，没路引的人走近了，兵就过来了。」", "「东头皮毛便宜，是血刀门收山转出来的。便宜有便宜的道理。」"],
        {"nw": "road_xixia_1"}),
    "xixia_post": ("兴庆驿", "xixia",
        "西夏官驿，规矩比中原的重：进门脱刀，刀挂在门边，走的时候自己取。堂上一面墙全是号牌，驿卒按牌传信，一天三班，雨雪不断。柜台上的墨是冻的，要用嘴呵开。",
        ["「信到这儿换马不换人。人歇马不歇，这是规矩。」", "「往南去的信三天到黄河渡口。渡口的船认驿牌，你手上有驿牌，船就等你。」"],
        {"ne": "road_xixia_1"}),
    "xixia_pass": ("贺兰隘口", "xixia",
        "两山夹一线，隘口窄得只容两马并行。风从口子里灌出来，四季不停。口子两侧的石壁上凿着历代戍卒的名字，深的深浅的浅，最上面一行已经快平了。抬头只看见一线天。",
        ["「过隘口别说话。回声传得远，山那头听着的是什么人，没人知道。」", "「石壁上的名字，刻上去的都走了，一个也没回来收。」"],
        {"w": "kunlun_gate"}),
}

# 新房对既有房的回边（既有房 exits 增补）
# ⚠ 2026-10-15 扫尾④：回边一律配「对向空闲方向对」，绝不占既有房的原向键——
#   首版 BACK_LINKS 无条件赋值（if ex.get(d) != to: ex[d] = to）把 git 原版
#   四处对边压掉（road_xixia_1.n/s、xiyu_oasis.n、road_beijiang_1.w、
#   beijiang_xuedao.e），map-check 7 项非严格反向的病根。原边恢复见下方
#   RESTORE 段；road_beijiang_1.w 走 GATES（保头闸对象）。
BACK_LINKS = {
    "beijiang_shankou": {"n": "beijiang_hunting_hut", "s": "beijiang_lookout"},
    "beijiang_xuedao": {"w": "beijiang_market"},          # ↔ market.e（market 自身 e）
    "road_beijiang_1": {"se": "beijiang_yizhan"},          # ↔ yizhan.nw；nw 被 82_treasury 后载占（xuedao_library），避让
    "xiyu_shule": {"e": "xiyu_bazaar"},
    "xiyu_oasis": {"s": "xiyu_caravanserai", "nw": "xiyu_well"},  # well↔oasis 用 nw/se
    "xiyu_xingxiu": {"w": "xiyu_herb_hut"},
    "xixia_yanchang": {"e": "xixia_salt_shed"},
    "road_xixia_1": {"se": "xixia_market", "sw": "xixia_post"},   # 原向 n/s/e/w 不再占用
    "kunlun_gate": {"e": "xixia_pass"},
}


def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)


def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')
P70 = os.path.join(ROOT, 'game', 'data', '70_world.json')
d50, d70 = read(P50), read(P70)
dirty50 = dirty70 = False

# ---------- ① F5 六闸门 ----------
for (rid, d), gate in GATES.items():
    cur = d50['rooms'][rid]['exits'].get(d)
    if cur != gate:
        d50['rooms'][rid]['exits'][d] = dict(gate)
        dirty50 = True

# ---------- ③ F7 废边删除 ----------
# s 侧（城东官道→黑木崖山门）+ n 侧对向残留（山门→官道，下山捷径绕开山道）。
# 黑木崖出入=行路 mojiao↔changan（cond act3_done）+ 88 山道，步行直连彻底断。
if d50['rooms']['jiangnan_east_road']['exits'].get('s') == 'mojiao_shanmen':
    del d50['rooms']['jiangnan_east_road']['exits']['s']
    dirty50 = True
if d50['rooms']['mojiao_shanmen']['exits'].get('n') == 'jiangnan_east_road':
    del d50['rooms']['mojiao_shanmen']['exits']['n']
    dirty50 = True

# ---------- ④ 地标房 12 间 + 回边 ----------
for rid, (name, region, desc, talk, exits) in LANDMARKS.items():
    if rid not in d50['rooms']:
        d50['rooms'][rid] = {"id": rid, "name": name, "region": region, "desc": desc, "talk": talk, "exits": dict(exits)}
        dirty50 = True
# ⚠ 回边分家：目标房在 50_map 的直接补；不在的（kunlun_gate 在门派分片）
# 落 104 扩展分片（rooms.exits 按键深合并，不动门派分片）。
P104 = os.path.join(ROOT, 'game', 'data', '104_birth_polish.json')
d104 = read(P104)
dirty104 = False
for rid, links in BACK_LINKS.items():
    if rid in d50['rooms']:
        ex = d50['rooms'][rid].setdefault('exits', {})
        for d, to in links.items():
            if ex.get(d) != to:
                ex[d] = to
                dirty50 = True
    else:
        ex = d104.setdefault('rooms', {}).setdefault(rid, {'id': rid}).setdefault('exits', {})
        for d, to in links.items():
            if ex.get(d) != to:
                ex[d] = to
                dirty104 = True
if dirty104:
    d104['_note'] = (d104.get('_note') or '') + " 批2回边（kunlun_gate 等非 50_map 房的 exits 增补，深合并不覆盖既有键）。"
    write(P104, d104)
    print('OK: 104 回边（门派分片房的 exits 增补）')

# ---------- F6-c（须在 50_map 写盘前）：regions.entry beijiang 改挂官道 ----------
# 原 entry=beijiang_xuedao（血刀门大殿）= 行路空降门派；改挂 road_beijiang_1。
# ⚠ entry 声明在 50_map.json 的 regions 块（不在 70_world——全库 entry 只此一家；
#   引擎三处消费：engine.js:1470 大地图 / commands.js:4994 行路落点 / maplayout.js:345 布局起点）。
rgs = d50.setdefault('regions', {})
if rgs.get('beijiang', {}).get('entry') != 'road_beijiang_1':
    rgs.setdefault('beijiang', {})['entry'] = 'road_beijiang_1'
    dirty50 = True

# ---------- 扫尾④（2026-10-15）：原边恢复 + 方向重配自愈 ----------
# 归因（git 实锤）：首版 BACK_LINKS 无条件赋值压掉 git 原版四处对边——
#   road_xixia_1 n→road_xiyu_1 / s→xixia_ice、xiyu_oasis n→xiyu_shule、
#   beijiang_xuedao e→beijiang_houzhai（road_beijiang_1.w→road_many_1 走 GATES）。
#   F8/F9 补丁（road_xixia_1.sw→road_xiyu_1、xiyu_oasis.sw↔xiyu_shule.ne）
#   全是给自己挖的坑打的——原边恢复后多余，删。
RESTORE = {  # git 原版对边恢复（键值与 HEAD 逐字一致）
    ("road_xixia_1", "n"): "road_xiyu_1",
    ("road_xixia_1", "s"): "xixia_ice",
    ("xiyu_oasis", "n"): "xiyu_shule",
    ("beijiang_xuedao", "e"): "beijiang_houzhai",
}
# 新房自身方向重配（旧方向键删除 + 新方向键落位；新房已存在，LANDMARKS 不再触）
REPAIR_OWN = {  # rid -> (新增 {方向: 目标}, 删除 [旧方向键])
    "beijiang_market": ({"e": "beijiang_xuedao"}, ["w"]),
    "beijiang_yizhan": ({"nw": "road_beijiang_1"}, ["e", "se"]),   # 首配 se 被 82 后载占 nw 连带避让，改 nw↔se
    "xiyu_well": ({"se": "xiyu_oasis"}, ["s"]),
    "xixia_market": ({"nw": "road_xixia_1"}, ["s"]),
    "xixia_post": ({"ne": "road_xixia_1"}, ["n"]),
}
# 死键清理：F8 首版 nw 死键 / F8 sw 补丁 / F9 sw+ne 补丁（原边恢复后全多余）/
#   首配 road_beijiang_1.nw=黑水驿（82_treasury 后载占 nw=xuedao_library，50 侧删掉）
DEAD_KEYS = [
    ("road_xixia_1", "nw"),
    ("xiyu_oasis", "sw"),
    ("xiyu_shule", "ne"),
    ("road_beijiang_1", "nw"),
]
for (rid, d), to in RESTORE.items():
    ex = d50['rooms'][rid]['exits']
    if ex.get(d) != to:
        ex[d] = to
        dirty50 = True
for rid, (adds, dels) in REPAIR_OWN.items():
    ex = d50['rooms'][rid]['exits']
    for d in dels:
        if d in ex:
            del ex[d]; dirty50 = True
    for d, to in adds.items():
        if ex.get(d) != to:
            ex[d] = to; dirty50 = True
for rid, d in DEAD_KEYS:
    ex = d50['rooms'][rid]['exits']
    if d in ex:
        del ex[d]; dirty50 = True

if dirty50:
    write(P50, d50)
    print('OK: 50_map（F5 七闸门（含出北疆保头） + F7 废边删 + 地标房 12 间 + 回边 + 扫尾④原边恢复+方向重配 + F6-c entry 改官道）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------- ② F6 行路修正 ----------
links = d70.setdefault('travel', {}).setdefault('links', [])
# F6-a：luoyang↔mojiao 双向改挂 beijiang
for l in links:
    if l.get('from') == 'luoyang' and l.get('to') == 'mojiao':
        l['to'] = 'beijiang'; dirty70 = True
    if l.get('from') == 'mojiao' and l.get('to') == 'luoyang':
        l['from'] = 'beijiang'; dirty70 = True
# F6-b：新增 luoyang↔beijiang 行路边（若 F6-a 已改出则不重复加）
has_lb = any((l.get('from') == 'luoyang' and l.get('to') == 'beijiang') for l in links)
if not has_lb:
    links.append({
        "from": "luoyang", "to": "beijiang", "kind": "cross", "cond": "act2_done",
        "gateText": "河冰停了（卷二收束）",
        "refusal": "老船工把手拢在耳朵后头：「冰没化实，船不敢开。去年这时候翻了一条。」他侧过那只好的耳朵，「你听。冰底下有响声的，是化了芯。响了三天了。响够了才走得人。」末了补一句，「急什么。河比你老。」",
        "say": "那天早上他没叫你，是他把船缆解开又系上，解开又系上，解到第三回才朝你抬了抬下巴。「冰停了。上船。」船开出去，他背对着你说，「坐船尾。船头溅水。你要是晕，就看河心，别看岸。岸走得慢，河心走得快，看着看着就到了。」",
    })
    links.append({
        "from": "beijiang", "to": "luoyang", "kind": "cross", "cond": "act2_done",
        "gateText": "河冰停了（卷二收束）",
        "refusal": "老船工把手拢在耳朵后头：「冰没化实，船不敢开。急什么。河比你老。」",
        "say": "老船工解开船缆。「冰停了。上船。」",
    })
    dirty70 = True
# F6-c 已挪至 50_map 写盘前（regions.entry 在 50_map 分片，不在 70_world）

if dirty70:
    write(P70, d70)
    print('OK: 70_world（F6-a 边改挂 beijiang + F6-b 行路边）')
else:
    print('OK（已落，跳过）: 70_world')

# ---------- 断言 ----------
d50v, d70v = read(P50), read(P70)
for (rid, d), gate in GATES.items():
    assert d50v['rooms'][rid]['exits'][d] == gate, (rid, d)
assert 's' not in d50v['rooms']['jiangnan_east_road']['exits'], 'F7 废边没删净'
assert 'n' not in d50v['rooms']['mojiao_shanmen']['exits'], 'F7 对向残留没删净'
for rid in LANDMARKS:
    assert rid in d50v['rooms'] and d50v['rooms'][rid]['desc'], rid
assert d50v['rooms']['road_beijiang_1']['region'] == 'beijiang', 'entry 目标房区域不对'
assert d50v['regions']['beijiang']['entry'] == 'road_beijiang_1', 'F6-c entry 没落'
# 扫尾④：原边恢复（与 git HEAD 逐字一致）
assert d50v['rooms']['road_xixia_1']['exits']['n'] == 'road_xiyu_1', '原边 road_xixia_1.n 没恢复'
assert d50v['rooms']['road_xixia_1']['exits']['s'] == 'xixia_ice', '原边 road_xixia_1.s 没恢复'
assert d50v['rooms']['xiyu_oasis']['exits']['n'] == 'xiyu_shule', '原边 xiyu_oasis.n 没恢复'
assert d50v['rooms']['beijiang_xuedao']['exits']['e'] == 'beijiang_houzhai', '原边 xuedao.e 没恢复'
# 扫尾④：新房方向重配对（两侧对向咬合）
assert d50v['rooms']['beijiang_xuedao']['exits']['w'] == 'beijiang_market'
assert d50v['rooms']['beijiang_market']['exits']['e'] == 'beijiang_xuedao'
assert 'w' not in d50v['rooms']['beijiang_market']['exits']
assert d50v['rooms']['beijiang_yizhan']['exits']['nw'] == 'road_beijiang_1'
assert d50v['rooms']['road_beijiang_1']['exits']['se'] == 'beijiang_yizhan'
assert 'e' not in d50v['rooms']['beijiang_yizhan']['exits']
assert 'se' not in d50v['rooms']['beijiang_yizhan']['exits']
assert 'nw' not in d50v['rooms']['road_beijiang_1']['exits'], '首配 nw 没删（82_treasury 后载占此键）'
assert d50v['rooms']['xiyu_oasis']['exits']['nw'] == 'xiyu_well'
assert d50v['rooms']['xiyu_well']['exits']['se'] == 'xiyu_oasis'
assert 's' not in d50v['rooms']['xiyu_well']['exits']
assert d50v['rooms']['road_xixia_1']['exits']['se'] == 'xixia_market'
assert d50v['rooms']['xixia_market']['exits']['nw'] == 'road_xixia_1'
assert 's' not in d50v['rooms']['xixia_market']['exits']
assert d50v['rooms']['road_xixia_1']['exits']['sw'] == 'xixia_post'
assert d50v['rooms']['xixia_post']['exits']['ne'] == 'road_xixia_1'
assert 'n' not in d50v['rooms']['xixia_post']['exits']
# 扫尾④：F8/F9 补丁死键删净
assert 'nw' not in d50v['rooms']['road_xixia_1']['exits'], 'F8 首版死键 nw 没清'
assert 'sw' not in d50v['rooms']['xiyu_oasis']['exits'], 'F9 绿洲 sw 补丁没删'
assert 'ne' not in d50v['rooms']['xiyu_shule']['exits'], 'F9 疏勒 ne 补丁没删'
# 扫尾④：出北疆保头闸（road_many_1.e 的严格反向）
assert d50v['rooms']['road_beijiang_1']['exits']['w']['to'] == 'road_many_1', '保头闸没落'
lv = d70v['travel']['links']
assert not any(l['from'] == 'luoyang' and l['to'] == 'mojiao' for l in lv), 'F6-a 没改净'
assert any(l['from'] == 'luoyang' and l['to'] == 'beijiang' and l['cond'] == 'act2_done' for l in lv)
print('断言全过：七闸门对象逐字钉死（含出北疆保头）/ 废边删净 / 12 地标房 / 原边恢复+方向重配对 / F8-F9 补丁死键删净 / entry=官道 / 行路边（引擎合并层验证见复跑）')
