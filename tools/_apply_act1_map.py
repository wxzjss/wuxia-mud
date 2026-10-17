# -*- coding: utf-8 -*-
"""开工第一窗：act1 地理施工 + 主线修（design/96/98/97 M1/M2/M4/M7，2026-10-16 游有方）
- G1/G2 茶摊 n/s 闸门（cond act1_recognized，93 口径：**say=被拦戏先出口，msg 兜底，travel=放行过场**——
  寇豆码抓的初版装反已全六门+两处语义门对调）
- G3 旧道 nw 常闭塌方折返（旧道房不删，看垫石保留）+ 旧道语义残留两处改
- G4/G5/G6 华山道三漏补闸（穷举发现：少林道/回城/藏经阁）
- α 狼双保险：103 片 def.room 保底（懒生成不掷点）+ 50_map respawn 定岗（不游走）
- 接信补指路（青溪村小铺掌柜）；回茶摊双分支文案 当铺→小铺 同步
- 62_shops 摘除 jn_pawnshop「给掌柜看信」（当铺本体三件不动）
- 新分片 103_act1_rework.json：cunzhen_inn 承接看信 + cunzhen_farm 追鸡轻功
- M1 q_main_jianghu stage0 cond or 形；M2 主线指路两句；M4 q_huashan_spy 可达性修；
  M7 102 思过崖两案 require
- 82 分片 road_huashan_1.exits.s 抄回 G6 全量门对象（后载覆盖修复，gen-treasury-place.js 同步钉挂点）
幂等：重复执行不重复追加。
"""
import json, copy

BAD = ["不由得", "霎时间", "眼底闪过", "不禁", "仿佛"]

def load(p): return json.load(open(p, encoding='utf-8'))

def check(s):
    for b in BAD:
        assert b not in s, f"禁忌词 {b}: {s}"

d50 = load('game/data/50_map.json')
d62 = load('game/data/62_shops.json')
d60 = load('game/data/60_quests.json')
d65 = load('game/data/65_mainline_act3.json')
d102 = load('game/data/102_classic_quests.json')
d40 = load('game/data/40_npcs.json')
rooms = d50['rooms']

# ---------- 一、G1/G2 茶摊闸门 ----------
# ⚠️ 93 口径（commands.js doMove）：cond 不过 → 先出 **say**（门前人说的话），
#    say 缺了才退 msg。初版把放行句写进 say、拦人句写进 msg——被拦玩家看到的是
#    「进去吧」，拦人句永远不出口（寇豆码 storybeat 还正口径时抓的）。
#    对调：say=拦人戏，travel=放行过场，msg 退化为兜底（有 say 时永不出口）。
G1 = {
    "to": "jiangnan_gate",
    "cond": {"flag": "act1_recognized"},
    "say": "「城门口查得紧。」守门的兵把枪杆横过来，「进城得有人认你的名。你这名号，城里没人听过。」",
    "msg": "守门的兵把枪杆横过来，没让路。进城得有人认你的名。",
    "travel": "你从盘查的人堆里挤过去，进了南门。门洞里的人看了你一眼，没拦。",
}
G2 = {
    "to": "road_jiangnan_2",
    "cond": {"flag": "act1_recognized"},
    "say": "岔路口的老槐树底下蹲着两个汉子，斧子搁在膝盖上。站着的那个朝你努了努嘴：「南边这条道，买路的先说说价钱。」他看你两手空空，又把头低下去了，「没钱的，回去。」",
    "msg": "老槐树底下那两个汉子拦着道，没松口。",
    "travel": "你从那半条让开的道里走过去。背后有人说了一句什么，两个人都笑了，没拦你。",
}
r1 = rooms['road_jiangnan_1']
r1['exits']['n'] = G1
r1['exits']['s'] = G2

# ---------- 二、G4/G5/G6 华山道三漏 ----------
G4 = {
    "to": "road_shaolin_1",
    "cond": {"flag": "act1_recognized"},
    "say": "「往东是少室山的道。」路边歇脚的挑夫把扁担横过来，「这条道上的香客，都是有名帖的。你的名帖呢？」他看你答不上，摆摆手，「先把名头挣出来，再往东边去。」",
    "msg": "挑夫把扁担横过来，拦着东山道。",
    "travel": "你顺着东山道往下走。挑夫在背后又喊了一句：到了寺前，先看规矩再进门。",
}
G5 = {
    "to": "jiangnan_east_road",
    "cond": {"flag": "act1_recognized"},
    "say": "往西下到官道，远远看得见江南城的墙。守路的兵把册子一合：「进城登记。你这名号，册子上没有。」",
    "msg": "守路的兵合上册子，没让路。",
    "travel": "你顺着官道往城那边去。守路的兵低头接着写他的册子，没再看你。",
}
G6 = {
    "to": "huashan_library",
    "cond": {"flag": "act1_recognized"},
    "say": "守阁的弟子伸手拦住：「藏经阁是本门重地。你不是本门的人，这名头也还没挣到阁前。」",
    "msg": "守阁的弟子拦在阁前。",
    "travel": "你放轻脚步进了藏经阁。守阁弟子坐回门槛，接着晒他的太阳。",
}
rh = rooms['road_huashan_1']
rh['exits']['e'] = G4
rh['exits']['w'] = G5
rh['exits']['s'] = G6

# ---------- 三、G3 旧道 nw 常闭折返 + 语义残留两处 ----------
G3 = {
    "to": "shanjiao_inn",
    "cond": {"flag": "act1_oldroad_reopened"},
    "msg": "旧道往上再走三十步，塌方把整条路埋进了山壁。碎石堆里长着去年的草，再高的地方，人上不去。只能回头。",
    "say": "旧道往上再走三十步，塌方把整条路埋进了山壁。只能回头。",
    "travel": "塌方把整条路埋进了山壁。只能回头。",
}
# ⚠ cond 用永不被授予的 flag act1_oldroad_reopened：旧道通山顶这条边**永久关闭**，
#   但保留为 gated exit（拓扑不破双向对称判据，msg 出戏）。
rooms['oldroad']['exits']['nw'] = G3

# 动身 narrate 语义修正（旧道不再通山顶，「绕过去」是残留）
for a in rooms['road_jiangnan_1']['actions']:
    if a['cmd'] == '动身':
        for e in a['effects']:
            if e.get('type') == 'narrate' and '从山后绕过去的旧道' in e.get('raw', ''):
                e['raw'] = ("第二天早上你起身上路。地图的西南角多出一条细线：一条钻进山脚的旧道。那条道不在任何一张路引上，"
                            "断口让塌方埋死了，可前头那一段还能走。道旁有三处塌方，最险的那一处被人垫过，垫得不算平整，但能下脚。")
# cunzhen_gate.sw 的 say/msg 对调（同病）：say=被拦时道口的话，msg 兜底
# （幂等守卫认得两代旧态：初版「从山后绕过去」/上轮改的「你认得这条道了」）
cg = rooms['cunzhen_gate']['exits']['sw']
if isinstance(cg, dict) and ('从山后绕过去' in cg.get('say', '') or '你认得这条道了' in cg.get('say', '')):
    cg['say'] = "道口让塌方的碎石埋了大半，看着就是条走不得的野道。"
    cg['msg'] = "道口让塌方的碎石埋了大半，走不得。"
# shanjiao_inn.se 同病对调
si = rooms['shanjiao_inn']['exits']['se']
if isinstance(si, dict) and '见过那两块垫石的人才找得到它' in (si.get('say') or ''):
    si['say'] = "山脚东南树影里隐约有条道口，草长到了人腰，没人走过似的。"
    si['msg'] = "树影里那条道口看着走不得。"

# ---------- 四、α 狼：def.room 保底 + respawn 定岗（双保险，各治各的病） ----------
# ⚠️ 2026-10-16 两轮实测的教训（都在全套守卫里爆的）：
#   · 只加 respawn：newGame tick 里 rng.chance 掷点平移全局 RNG 流（smoke-ux2 客人序列翻车）；
#   · 只给 def.room：狼不再是「定岗」（isStationed 按 respawn 点名）——会游走离岗，
#     溜达进 road_wild_1 撞进双修测试的空房（smoke-dualcultivate 实锤 90→88）。
#   双保险的正确姿势：def.room 懒生成（不掷点、教学战狼必在）+ respawn 定岗（不游走、
#   死后重生）。狼活着时 alive>=count 短路，respawn 的 rng.chance 根本不执行——
#   种子流与无狼完全一致，两头的病一起断根。
wf = rooms['wild_forest_1']
wf.setdefault('respawn', [])
if not any(s.get('npc') == 'mob_wolf' for s in wf['respawn']):
    wf['respawn'].append({"npc": "mob_wolf", "count": 1, "chance": 0.5})

# ---------- 五、接信补指路 + 回茶摊文案同步 ----------
for a in rooms['road_jiangnan_1']['actions']:
    if a['cmd'] == '接信':
        if not any('小铺的掌柜' in (e.get('raw') or '') for e in a['effects']):
            a['effects'].insert(1, {"type": "narrate", "raw":
                "「识字的，」老汉想了想，「青溪村小铺的掌柜算一个。村在路东，过了村口就是。他看得出门道。」"})
    if a['cmd'] == '回茶摊':
        a['desc'] = a.get('desc', '').replace('当铺的事，说不说', '小铺掌柜那番话，说不说')
        for e in a['effects']:
            if e.get('type') == 'menu' and '当铺掌柜' in e.get('raw', ''):
                e['raw'] = e['raw'].replace('把当铺掌柜的话学给他听', '把小铺掌柜的话学给他听') \
                                   .replace('你把当铺掌柜的话学了一遍', '你把小铺掌柜的话学了一遍')

# ---------- 六、62_shops 摘除「给掌柜看信」（当铺其余三件原样不动） ----------
pa = d62['rooms']['jn_pawnshop']['actions']
moved = None
for i, a in enumerate(pa):
    if a.get('cmd') == '给掌柜看信':
        moved = pa.pop(i)
        break
if moved is None:
    # 幂等：已在 103 片则视为已迁移
    try:
        d103_old = load('game/data/103_act1_rework.json')
        moved = next(a for a in d103_old['rooms']['cunzhen_inn']['actions'] if a.get('cmd') == '给掌柜看信')
    except Exception:
        moved = None
assert moved is not None, 'jn_pawnshop 没找到给掌柜看信（且 103 片无存档）'
assert all(a.get('cmd') != '给掌柜看信' for a in pa), 'jn_pawnshop 仍有看信 action'

# ---------- 七、新分片 103：cunzhen_inn 承接看信 + cunzhen_farm 追鸡 ----------
moved2 = copy.deepcopy(moved)
moved2['label'] = '掌柜'
moved2['keywords'] = ['掌柜', '看信', '小铺']
moved2['desc'] = '把信递给铺子里的掌柜'
d103 = {
    "_note": ("act1 地理施工承接片（design/96/98，2026-10-16 游有方）：①「给掌柜看信」自 62_shops jn_pawnshop 迁入 "
              "cunzhen_inn（江南城锁区后，看信一环落青溪村·村口小铺；小铺无货摊实体，"
              "list 类 action 摘除——actions-check A-2：真执行不许出「没有做买卖的人」）；"
              "②cunzhen_farm「追鸡」场景补卷一轻功断供（99 §4.2 定案：卷一末必须会一门轻功，"
              "武馆/书都在锁区，追出来的轻功落 act1 腹地），keywords 补「田地」对齐 81 批交互名词施工图；"
              "③α 狼双保险：def.room=wild_forest_1（**只写差异字段**：world.js mergeEntry 对已存在 entry 走"
              "deepMerge 字段级合并——40_npcs 全文 def 先载（文件名序 40<103），103 的 room/noWander 原语覆盖即可，"
              "初版全量 deepcopy 是「防 replace 丢字段」的错判，mergeData 实证为深合并；懒生成不掷点、教学战必在）"
              "+ 50_map respawn 定岗（不游走、死后重生；狼活着时 alive>=count 短路不掷点，种子流不偏）"
              "+ noWander 钉住（野地默认 20% 游走率会漂出教学位）。两房原无 actions，本片整段声明，无数组 replace 风险。"),
    "npcs": {
        # noWander：α 狼是教学战怪，钉在黑松林等新手（defaultWanderFor 给野地默认 20%
        # 游走率，会溜达进 road_wild_1——双修测试空房实锤过 90→88，设计上也不该漂）。
        "mob_wolf": {"id": "mob_wolf", "room": "wild_forest_1", "noWander": True},
    },
    "rooms": {
        "cunzhen_inn": {
            "id": "cunzhen_inn",
            "actions": [
                moved2,
            ],
        },
        "cunzhen_farm": {
            "id": "cunzhen_farm",
            "actions": [
                {
                    "cmd": "追鸡", "label": "追鸡", "keywords": ["追鸡", "芦花鸡", "逮鸡", "田地"],
                    "desc": "田里那只谁也逮不着的芦花鸡",
                    "say": "追鸡",
                    "cond": {"notFlag": "act1_chicken_chased"},
                    "once": True,
                    "failMsg": "那只芦花鸡你今天已经追够了。",
                    "effects": [
                        {"type": "narrate", "raw": "田里的芦花鸡从秧苗里扑出来，你追了它三趟。头两趟它从你手边溜走，第三趟你踩着田埂跑，脚下忽然轻了半分，一把把它按在了稻草堆上。"},
                        {"type": "narrate", "raw": "鸡在你手里扑腾，你自己倒愣住了。踩着田埂跑的那一段路，步子跟平常走路不是一回事。你把它放了，它咯咯叫着钻回秧苗里，像什么都没发生。"},
                        {"type": "learnskill", "args": ["basic_dodge"]},
                        {"type": "flag", "args": ["act1_chicken_chased"]},
                    ],
                },
            ],
        },
    },
}

# ---------- 八、主线修（M1/M2/M4/M7） ----------
# M1 散人主线死锁
st0 = d60['quests']['q_main_jianghu']['stages'][0]
st0['cond'] = {"or": [{"hasSect": True}, {"flag": "act1_recognized"}]}
# M2 q_main_sect 收束句补指路
rw = d60['quests']['q_main_sect']['rewards']
if not any('洛阳当铺' in (e.get('raw') or '') for e in rw):
    rw.append({"type": "narrate", "raw":
        "临别冲虚又补了一句：「要摸清这批东西的来路，先去洛阳当铺问一页旧账，再去成都书坊问一副旧版。路在这两处。」"})
# M2 q_main_snow 开场补指路
qs = d65['quests']['q_main_snow']
if '洛阳当铺' not in qs['desc']:
    qs['desc'] += "先把手边这页纸的来路摸清：洛阳当铺有一页账，成都书坊有一副版。"
# M4 q_huashan_spy 可达性修（97 M4 复核修正：两案非同戏，修可达不并线——
#    探黑木崖是岳不群的烟幕层，删了就丢他人设；真正要修的是「接得到走不到」）
d60['quests']['q_huashan_spy']['require']['flag'] = 'act3_done'
# M7 思过崖两案 require
for qid in ('sq_yang_guo_muqian', 'sq_feng_qingyang_shoujian'):
    d102['quests'][qid]['require'] = {"flag": "act1_recognized"}

# ---------- 九、82 分片 road_huashan_1.exits.s 抄回 G6 门对象（穷举验收实锤的后载覆盖 bug） ----------
# 82_treasury_place 按文件名排在 50_map 之后加载，exits 按键合并「后载胜」——
# 82 里裸字符串 "s":"huashan_library" 会把 50_map 的 G6 门整个抹掉（fresh 档藏经阁可达）。
# 新分片声明必须抄回全部旧条目（合并三陷阱铁律）；生成器 gen-treasury-place.js 已同步修。
d82 = load('game/data/82_treasury_place.json')
p82 = d82['rooms']['road_huashan_1']
# 内容比对（不是只看有没有 cond）：say/msg 口径升级后旧版门对象也要跟着换新
if p82['exits'].get('s') != G6:
    p82['exits']['s'] = copy.deepcopy(G6)

# ---------- 断言 ----------
for g in (G1, G2, G3, G4, G5, G6):
    for k in ('msg', 'say', 'travel'):
        assert g.get(k), k
        check(g[k])
assert rooms['road_jiangnan_1']['exits']['e'] == 'cunzhen_gate'
assert rooms['road_jiangnan_1']['exits']['w'] == 'road_wild_1'
assert any(s.get('npc') == 'mob_wolf' for s in rooms['wild_forest_1']['respawn']), '狼 respawn 缺失（定岗靠它）'
assert d103['npcs']['mob_wolf']['room'] == 'wild_forest_1'
assert d103['npcs']['mob_wolf']['noWander'] is True
assert set(d103['npcs']['mob_wolf'].keys()) == {'id', 'room', 'noWander'}, '狼 def 只写差异字段（mergeEntry 深合并补全 40 全文；瘦的是分片体积，不是战斗数值）'
assert 'act1_oldroad_reopened' == rooms['oldroad']['exits']['nw']['cond']['flag']
assert not any(a.get('cmd') == '给掌柜看信' for a in d62['rooms']['jn_pawnshop']['actions'])
assert d60['quests']['q_main_jianghu']['stages'][0]['cond'] == {"or": [{"hasSect": True}, {"flag": "act1_recognized"}]}
assert d60['quests']['q_huashan_spy']['require'].get('flag') == 'act3_done'
assert d102['quests']['sq_yang_guo_muqian']['require'] == {"flag": "act1_recognized"}
assert d82['rooms']['road_huashan_1']['exits']['s'] == G6, '82 分片 s 必须是全量门对象（后载覆盖修复）'
for st_txt in [moved2['effects'][1]['raw'], d103['rooms']['cunzhen_farm']['actions'][0]['effects'][0]['raw']]:
    check(st_txt)

# ---------- 写盘（口径：50/60/62/65/102 indent=2 尾换行 LF；103 新建 indent=2 尾换行 LF） ----------
def save(d, p):
    from _canon_write import write_canon as _wc
    _wc(p, p)
save(d50, 'game/data/50_map.json')
save(d62, 'game/data/62_shops.json')
save(d60, 'game/data/60_quests.json')
save(d65, 'game/data/65_mainline_act3.json')
save(d102, 'game/data/102_classic_quests.json')
save(d103, 'game/data/103_act1_rework.json')
save(d82, 'game/data/82_treasury_place.json')

for p in ('game/data/50_map.json', 'game/data/62_shops.json', 'game/data/60_quests.json',
          'game/data/65_mainline_act3.json', 'game/data/102_classic_quests.json',
          'game/data/103_act1_rework.json', 'game/data/82_treasury_place.json'):
    raw = open(p, 'rb').read()
    assert b'\r' not in raw, p
    json.loads(raw.decode('utf-8'))
print('OK: G1-G6 六门 + 旧道折返 + 狼 spawn + 看信迁移 + 追鸡 + M1/M2/M4/M7')
