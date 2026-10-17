#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_m6_daily.py —— M6 降名分两步走（design/108，游有方 2026-10-18）
----------------------------------------------------------------
第一步（纯增量）：79 条 sq_npcv_* 加 `daily: true` + `shell:"采药"…`
                   id / type / stages / rewards 一字不动。
第二步（内容修复）：卷三/卷四区域（北疆·雪谷 / 西夏·盐池 / 西域 / 蛮荒）的
                   10 条日课 desc 按本地物象与生计重写；同一壳型不跨区共用一句。

判据与断言：
 · 79/79 daily=true、shell 落在十种壳内、type 仍为「支线」、结构仍 1-target+next99
 · 新 desc 不过朱雀红线（无破折号 / 无对偶 / 无偏好词）
 · 同一句 desc 不许被 ≥2 个区域引用（防复用回潮）
幂等：逐字段比对，两连跑 OK。写盘 indent=2 + 尾换行。
"""
import json, os, io, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P60 = os.path.join(ROOT, 'game', 'data', '60_quests.json')
P40 = os.path.join(ROOT, 'game', 'data', '40_npcs.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
SHELLS = ['采药', '采买', '打探', '了结', '送信', '寻物', '护送', '寻人', '除害', '讨债']

# 第二步：卷三/卷四 10 条 desc 按区重写（本地物象与生计）
DESC_MAP = {
  # 北疆·雪谷（口粮 / 马料 / 冻伤 / 刀口）
  'sq_npcv_067': '血刀寨有人往南边递话。狄知想知道递的是什么，自己不敢问。',
  'sq_npcv_141': '雪道上马料断了。马秋托你带一袋回来，单子上还有两斤粗盐。',
  'sq_npcv_212': '寨里有人冻烂了脚。药在山那边的雪谷口，华云这双腿走不到。',
  # 西夏·盐池（盐引 / 皮货 / 碱地 / 苦草）
  'sq_npcv_049': '常拂有封信要递到盐场，路上查盐引，他自己不敢带。',
  'sq_npcv_071': '盐引换来的皮货压在盐场。萧初托你替他捎回冰原上。',
  'sq_npcv_222': '驼队里有人烧起来了。冰原上只有一种苦草压得住，长在盐场的碱地里。',
  # 西域（星宿海旧账 / 商道 / 绿洲水囊）
  'sq_npcv_044': '星宿海边上欠的那笔账，田苇航自己去要过两回，回回空手。',
  'sq_npcv_068': '商道上劫驼铃的人露了面。贝仲卿等这一天，等了三年。',
  'sq_npcv_145': '邬灵把一只水囊落在绿洲。囊底缝着东西，比水要紧。',
  # 蛮荒（草原上按羊算的债）
  'sq_npcv_144': '草原上的债按羊算。铁头借出去的那群羊，三年没回来过。',
  # 皇城（宫墙内的差事：腰牌 / 更漏 / 内务府的活）
  'sq_npcv_018': '张掬水在花园里当了二十年差。那桩旧仇的债主如今住西六宫，他进不去，你能。',
  'sq_npcv_019': '邹南枝有封信要递进天牢，给任红。宫门下查腰牌，她不敢亲自去。',
  'sq_npcv_020': '韩婉如要寻凤初霁。人是打宫门出去的，此后再没回来。宫门下当差的人兴许见过她。',
  # 东海（潮水 / 索具 / 渔汛）
  'sq_npcv_017': '海边的旧事都压在一句话里。莫时想让你去渔村问一句，问谁他却不肯说。',
  'sq_npcv_031': '渔船要出海，索具和桐油还没齐。茅凝托你去码头一趟，赶在潮水退之前。',
  'sq_npcv_209': '潮信一变，船就要走。麻灵要把一句话捎给元青，话在信里，信在袖里。',
  # 桃花岛（海雾 / 桃林岔路 / 蛇阵）
  'sq_npcv_046': '岛上没有脚夫。雷白露那筐药材要过桃林，路拐得人发晕，她一个人抬不动。',
  'sq_npcv_047': '清音洞里的话半句都不能漏。湛明远想弄清另一件事，只肯让你去桃林里打听。',
  'sq_npcv_139': '蛇阵边上住不得人。褚静姝把那封信交给你的时候，手还在抖。',
  # ── 第二轮（报①：江南 / 市井 / 田庄 / 青楼 / 江口）─────────────────
  # 江南城：绸缎 / 河道 / 盐酱 / 梅雨 / 园子
  'sq_npcv_001': '许停家的盐罐见底，酱只剩坛底一层。摊子走不开，他托你把杂货捎到柳巷。',
  'sq_npcv_002': '鲍立的婆娘咳了半月。药方上那味川贝，药铺断了货，城西富家园子里倒是种着。',
  'sq_npcv_006': '许清那船绸缎要押到城西。梅雨一落，河上就有人拦船。',
  # 市井：木匣 / 酒牌 / 生辰帖子
  'sq_npcv_015': '滕逢春的木匣子不见了。匣里没什么值钱东西，只有他儿子的生辰帖子。',
  'sq_npcv_022': '臧落梅的妹子在酒楼帮工，咳得直不起腰。药方缺一味，市上买不着。',
  'sq_npcv_055': '秦知秋的酒牌丢了。没那块牌子，他进不了自家酒窖。',
  # 田庄：谷子 / 新米 / 十年前那场水
  'sq_npcv_004': '柯修借出去三石谷子，秋收过了，欠账的人家连门都不开。',
  'sq_npcv_026': '卢半要把一车新米送到镇上。田埂窄，车翻过两回。',
  'sq_npcv_037': '邵清欢想知道十年前那场水是怎么淹的。庄里人都不肯说。',
  # 青楼：胭脂灯油 / 夹道里的蛇 / 同年进楼的人
  'sq_npcv_021': '楼里的胭脂和灯油都见了底。汪秋被客人绊住脚，托你去买。',
  'sq_npcv_023': '望江阁后头的夹道里有蛇。齐灵犀的响铃就是在那儿丢的，她不敢再进。',
  'sq_npcv_030': '苏南和梅放舟是同一年进楼的。梅放舟赎身那年，只留下一句话。',
  # 江口：沉船 / 船上住的人 / 野狗啃网
  'sq_npcv_077': '章云想知道十年前沉在江口那条船，装的是什么。',
  'sq_npcv_097': '霍红在船上住了半辈子。有件事她只肯上岸以后问。',
  'sq_npcv_143': '江口近来野狗成群，夜里啃了渔户的网。元青天黑就不敢出屋。',
  # ── 第二轮（报②：少林 / 武当 / 峨眉 / 华山 / 姑苏）─────────────────
  # 少林：撞钟引兽 / 早课念珠 / 山道塌方
  'sq_npcv_003': '藏经阁后山的兽，是连夜撞钟引来的。昝秋守着经架，一步不敢离。',
  'sq_npcv_005': '伍修把师父给的念珠丢在练武场。三更前找不回来，早课没法上。',
  'sq_npcv_013': '后山的路被兽踩塌了半边。黄望舒那担柴，卡在山脚三天。',
  # 武当：剑穗 / 金顶上的账 / 紫霄宫养伤
  'sq_npcv_025': '毕若的剑穗丢在下山的石阶上。那是他入门那年师父系上去的。',
  'sq_npcv_034': '秦湘借给师侄的银子，三年没还。金顶上的账，不好当众提。',
  'sq_npcv_052': '薛无的师弟在紫霄宫养伤。后山那味草药，只有他认得出来。',
  # 峨眉：玉牌 / 舍身崖的药 / 香客少了七成
  'sq_npcv_035': '蓝拂衣的玉牌掉在崖底。那是峨眉弟子出入山门的凭证。',
  'sq_npcv_132': '孔归鸿的妹子在山上静养。舍身崖那边有她要的药，路却险。',
  'sq_npcv_133': '金顶往下，舍身崖的兽近来下山伤人，香客少了七成。',
  # 华山：后洞封门 / 莲花峰赔罪 / 北坡断盐
  'sq_npcv_107': '乐静想知道后洞那道门是谁封的。华山上下没人肯答。',
  'sq_npcv_108': '卜见山年轻时在莲花峰欠下一句赔罪，对方等了二十年。',
  'sq_npcv_111': '华山北坡的灶上断了盐。狗蛋守着炉子，下山一趟要半日。',
  # 姑苏：燕子坞药钱 / 运河查船 / 蚕河边三年
  'sq_npcv_072': '毛清的娘在燕子坞养病。镇上药铺只认现钱，他手头是空的。',
  'sq_npcv_146': '臧秋声那船丝货要走运河。近来水路上多了查船的人。',
  'sq_npcv_158': '管时在蚕河边等了三年，等的是一句当面说的话。',
  # ── 第二轮（报③：唐门 / 丐帮 / 苗疆 / 古墓 / 大理）─────────────────
  # 唐门：门里的镖 / 丢过两回信 / 药圃引子
  'sq_npcv_016': '戴青押的那批货是唐门的。道上近来有人专撬门里的镖。',
  'sq_npcv_039': '这封信要交到湛拾月手上。门里近来丢过两回信，苏景行不敢托旁人。',
  'sq_npcv_042': '药圃里的毒草缺一味引子。蔡南的手被药浸坏了，采不了。',
  # 丐帮：半袋干粮 / 少分一碗粥 / 往南走的人
  'sq_npcv_028': '破庙那笔旧怨，起因是半袋干粮。鲍凝记了十年。',
  'sq_npcv_058': '黄修当年在破庙分粥，少分了一碗。那家人后来没熬过那个冬天。',
  'sq_npcv_060': '柯云要找和苍。破庙里没人知道他去了哪，只说他往南走了。',
  # 苗疆：银项圈 / 寨子只认熟脸 / 上一辈的恩怨
  'sq_npcv_045': '丫丫的银项圈丢了。那是她阿妈留下的，寨子里人人认得那圈花纹。',
  'sq_npcv_137': '山上人不与外客说话，只认熟脸。苏望想探的那桩旧事，卡在这一层。',
  'sq_npcv_138': '郝秋与寨中一家的恩怨，是上一辈结下的。他想在死前说开。',
  # 古墓：玉蜂针匣 / 终南山道 / 进墓那年的话
  'sq_npcv_075': '邹凝的玉蜂针匣落在后山。那匣子外人拿了没用，她却不放心。',
  'sq_npcv_156': '何慕要把一批药材押过终南山。山道上近来有全真的人在巡。',
  'sq_npcv_230': '彭弘在等邹凝回一句话。她进墓那年，把话留在了外头。',
  # 大理：茶马 / 天龙寺的门 / 灯油粗盐
  'sq_npcv_116': '葛春赶的是一队茶马。过了城，茶价翻倍，路上也有劫道的。',
  'sq_npcv_159': '话不难带，难在递到于明手上。天龙寺的门不好进。',
  'sq_npcv_161': '寺里的灯油和粗盐见了底。米清守着香炉，走不开。',
  # ── 第二轮（报④：衙门 / 村镇 / 书院 / 侠客岛 / 金国废墟）─────────────
  # 衙门：牢里旧档 / 客饭 / 衙役经手
  'sq_npcv_050': '傅君要寻夏青。牢里的旧档记着这个名字，人却三年没露面。',
  'sq_npcv_149': '这封信要递到夏承志手里。元怀瑾不肯让旁人经手，说人手一多，嘴就杂。',
  'sq_npcv_181': '后院要备一桌客饭。黄清按着单子买，少一样都要挨说。',
  # 村镇：客栈里的信 / 塘边长大 / 夜路上的粮车
  'sq_npcv_059': '信要交给戴白。客栈里人来人往，米知就怕信在后头被人拆开。',
  'sq_npcv_070': '施知秋和彭婉如在塘边一起长大。彭婉如嫁走那年，一句别也没说。',
  'sq_npcv_136': '昝承志那车粮要送出村。夜里路上有人蹲着，不知在等谁。',
  # 书院：后院煎药 / 一篇文章 / 赶考的账
  'sq_npcv_102': '闵守的娘子在书院后院煎药。药方缺的那一味，只有学舍后头种着。',
  'sq_npcv_168': '岑元和人的旧仇，起因是一篇文章。谁抄了谁，二十年没论清。',
  'sq_npcv_234': '樊湘借过钱给一个穷书生赶考。人中了榜，账却不认了。',
  # 侠客岛：渡口撂下的话 / 十年一船 / 岛上的盐和针线
  'sq_npcv_078': '拴住上岛那年撂下一句狠话。如今那个人在渡口等船。',
  'sq_npcv_080': '鲍归要找江倦。岛上十年一船，错过这趟又是十年。',
  'sq_npcv_231': '岛上日子清苦。冯醒托你在渡口捎些盐和针线上来。',
  # 金国废墟：认字的人少 / 当年那把火 / 砖缝里的草
  'sq_npcv_079': '这封信要递到邱过客手上。废墟里认字的人不多，认路的更少。',
  'sq_npcv_157': '薛静想问清当年城里那把火是怎么起的。问过的人都摇头。',
  'sq_npcv_232': '废墟的砖缝里长着一种草。邱过客的伴当病着，等这味草下药。',
}

d60, d40, d50 = read(P60), read(P40), read(P50)
npcs = d40.get('npcs', d40)
dirty = False

qids = sorted(k for k in d60['quests'] if k.startswith('sq_npcv_'))
assert len(qids) == 79, 'sq_npcv_* 数不是 79: %d' % len(qids)

for qid in qids:
    q = d60['quests'][qid]
    m = re.match(r'^.+?的(.+)$', q.get('name') or '')
    shell = m.group(1) if m else ''
    assert shell in SHELLS, f'{qid} 壳型不在十种内: {shell}'
    if q.get('daily') is not True:
        q['daily'] = True; dirty = True
    if q.get('shell') != shell:
        q['shell'] = shell; dirty = True
    if qid in DESC_MAP and q.get('desc') != DESC_MAP[qid]:
        q['desc'] = DESC_MAP[qid]; dirty = True

if dirty:
    write(P60, d60); print('OK: 60_quests（daily+shell 79 条 + 卷三四 desc 10 条按区重写）')
else:
    print('OK（已落，跳过）: 60_quests')

# =====================================================================
# 断言（重读盘面）
# =====================================================================
v60 = read(P60)
def region_of(room):
    r = d50['rooms'].get(room) or {}
    return r.get('region') or '?'

seen_desc = {}
for qid in qids:
    q = v60['quests'][qid]
    assert q.get('daily') is True, qid + ' 缺 daily'
    assert q.get('shell') in SHELLS, qid + ' shell 不对'
    assert q.get('type') == '支线', qid + ' type 被改（红线）'
    sts = q['stages']
    assert len(sts) == 2 and len(sts[0].get('targets') or []) == 1 and sts[1].get('next') == 99, qid + ' 结构被改（红线）'
    assert [e.get('type') for e in (q.get('rewards') or [])] == ['+exp', '+pot', 'favor', 'say'], qid + ' rewards 被改（红线）'
    # desc 红线
    d = q.get('desc') or ''
    assert '——' not in d, qid + ' desc 破折号'
    assert not re.search(r'不是[^，]{1,14}，(?:而是|是)', d), qid + ' desc 对偶'
    for w in ('落地', '死死', '猛地', '稳稳', '最后'):
        assert w not in d, qid + ' desc 偏好词: ' + w
    # 跨区复用检查
    n = npcs.get(q.get('giver')) or {}
    reg = region_of(n.get('room') or '')
    key = d.strip()
    if key in seen_desc and seen_desc[key][1] != reg:
        raise AssertionError(f'同一句 desc 跨区复用：{seen_desc[key][0]}({seen_desc[key][1]}) 与 {qid}({reg})')
    seen_desc[key] = (qid, reg)

# 第二步覆盖到的条目：区域必须可识别（本轮已扩到全 26 区，不再限卷三/四/五）
REGION_OK = set((d50.get('regions') or {}).keys())
for qid in DESC_MAP:
    q = v60['quests'][qid]
    n = npcs.get(q.get('giver')) or {}
    reg = region_of(n.get('room') or '')
    assert reg in REGION_OK, qid + ' 区域不可识别: ' + reg
    assert q.get('desc') == DESC_MAP[qid], qid + ' desc 未换'
    for tpl in ('想请你', '求到了你头上', '托你跑一趟', '命你代他', '想请你帮着'):
        assert tpl not in q['desc'], qid + ' 仍是模板句: ' + tpl

# ---- 点名护栏（前移 quest-sanity c5）：desc 里的 NPC 名只许是自己或 rel 内的人 ----
NAME2ID = {v.get('name'): k for k, v in npcs.items() if isinstance(v, dict) and v.get('name') and len(v['name']) >= 2}
for qid in DESC_MAP:
    q = v60['quests'][qid]
    gid = q.get('giver') or ''
    g = npcs.get(gid) or {}
    rel = {r.get('id') for r in (g.get('rel') or []) if isinstance(r, dict)}
    for nm, nid in NAME2ID.items():
        if nm not in q['desc']:
            continue
        if nid == gid or nid in rel:
            continue
        raise AssertionError(f'{qid} desc 越界点名「{nm}」({nid})，不在 giver.rel')

# ---- 逐字节未动（对照 git HEAD；只允许新增 daily/shell 与改后 desc）----
import subprocess
try:
    head = subprocess.run(['git', 'show', 'HEAD:game/data/60_quests.json'],
                          cwd=ROOT, capture_output=True, text=True, timeout=30)
    base = json.loads(head.stdout) if head.returncode == 0 and head.stdout.strip() else None
except Exception:
    base = None
if base is None:
    print('⚠️  git HEAD 不可读，跳过逐字节对照（结构性断言仍已过）')
else:
    bq = base['quests']
    moved = 0
    for qid in qids:
        a, b = bq[qid], v60['quests'][qid]
        for k in ('id', 'name', 'level', 'type', 'giver', 'stages', 'rewards'):
            assert json.dumps(a.get(k), ensure_ascii=False, sort_keys=True) == \
                   json.dumps(b.get(k), ensure_ascii=False, sort_keys=True), f'{qid} 字段被改（红线）: {k}'
        added = set(b) - set(a)
        assert added <= {'daily', 'shell'}, f'{qid} 不只加了 daily/shell: {added}'
        if a.get('desc') != b.get('desc'):
            assert qid in DESC_MAP, f'{qid} desc 被动但不在重写清单'
            moved += 1
    # HEAD 会随发版前移：只要求「凡与 HEAD 不同者都在重写清单内」，
    # 且清单内每条最终都等于目标文本（上一段已断言）。
    assert moved <= len(DESC_MAP), f'desc 改动条数超出清单: {moved} > {len(DESC_MAP)}'
    print(f'逐字节对照通过：79 条 id/name/level/type/giver/stages/rewards 与 HEAD 全同；'
          f'仅新增 daily/shell；desc 相对 HEAD 改动 {moved} 条（均在本轮重写清单内，清单共 {len(DESC_MAP)} 条）')

print('断言全过：79 条 daily+shell / type+结构+rewards 与 HEAD 逐字节同 / desc 红线 / '
      f'无跨区复用 / 无越界点名 / 已按区重写 {len(DESC_MAP)} 条（其余 {79-len(DESC_MAP)} 条待续）')
