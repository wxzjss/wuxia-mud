# -*- coding: utf-8 -*-
"""S3 卷二第二批落库（design/95 §八，2026-10-16 游有方）：
四案（长安/襄阳/成都/姑苏）照第一批范式：61 池深拷贝改造、目标迁址、收口联动段、
flag clue_* + incvar clue_count、效果级 +rep（每案一次）。
另落：四 NPC 双通道咬合 action（门派通道含 contrib 本门 40）、第一批两案补 contrib、
乙分支「请他作证」（蒋倦处）、浮名 action（方证/冲虚，clue_count>=4）、思过崖门槛（or 形）。
幂等：重复执行不重复追加（按 cmd/flag 查重）。
"""
import json, copy

BAD = ["不由得", "霎时间", "眼底闪过", "竟像"]

def load(p): return json.load(open(p, encoding='utf-8'))

def check_text(s):
    for b in BAD:
        assert b not in s, f"禁忌词 {b}: {s}"

d61 = load('game/data/61_sidequests.json')
q61, n61 = d61['quests'], d61['npcs']
d69 = load('game/data/69_juan2_s3.json')
d40 = load('game/data/40_npcs.json')
n40 = d40.get('npcs', d40)

d69.setdefault('quests', {})
d69.setdefault('npcs', {})
d69.setdefault('rooms', {})

# ---------- 助手 ----------
def quest_from_pool(qid):
    q = copy.deepcopy(q61[qid])
    for st in q.get('stages', []):
        st.setdefault('effects', [])
    if 'rewards' not in q:
        q['rewards'] = []
    return q

def retarget(q, room, stage_desc, target_desc):
    st = q['stages'][0]
    t = st['targets'][0]
    t['key'] = room
    t['desc'] = target_desc
    t['var'] = q['id'] + '_go0'
    st['desc'] = stage_desc

CATCH = "「这几桩案子搁在一起看，少的东西是同一路人拿走的。」"

def liandong(q, narrate, repkey, clue):
    """收口联动段：narrate + 效果级 +rep 60 + clue flag + clue_count。幂等。"""
    st = q['stages'][-1]
    st.setdefault('effects', [])
    have = {e.get('type'): e for e in st['effects'] if e.get('type') in ('flag',)}
    if any(e.get('type') == 'flag' and e.get('args', [None])[0] == clue for e in st['effects']):
        return
    st['effects'].append({"type": "narrate", "raw": narrate})
    st['effects'].append({"type": "+rep", "args": [repkey, 60]})
    st['effects'].append({"type": "flag", "args": [clue]})
    st['effects'].append({"type": "incvar", "args": ["clue_count", 1]})
    if CATCH not in q['rewards'][0]['raw']:
        q['rewards'][0]['raw'] += CATCH

def gate_action(cmd, kw, desc, flagname, sect, n1, n2):
    a = {
        "cmd": cmd, "label": cmd, "keywords": kw, "desc": desc,
        "cond": ({"hasSect": True, "notFlag": flagname} if sect
                 else {"noSect": True, "notFlag": flagname}),
        "once": True,
        "effects": [
            {"type": "narrate", "raw": n1},
            {"type": "narrate", "raw": n2},
            {"type": "flag", "args": [flagname]},
        ],
    }
    if sect:
        a["effects"].append({"type": "contrib", "args": ["本门", 40]})
        a["effects"].append({"type": "sys", "raw": "你在门里的差事簿上记了一笔。"})
    for e in a["effects"]:
        if 'raw' in e: check_text(e['raw'])
    return a

def has_cmd(actions, cmd):
    return any(a.get('cmd') == cmd for a in actions)

# ---------- 一、四案 quests ----------
# 长安：那半张盐引（弧口朝左的骑缝印）
q = quest_from_pool('hk_npcv_215_yanyin')
retarget(q, 'changan_market', '去长安·西市，对一对那半张盐引上的印',
         '去长安·西市，对一对那半张盐引上的印')
liandong(q, '盐引对光的斜角上压着半枚骑缝印，印泥没按匀，弧口朝左。这个印，你在别处见过。',
         '长安', 'clue_changan')
d69['quests'][q['id']] = q

# 襄阳：江上那三条船（铲痕里的半个船号）
q = quest_from_pool('hk_npcv_208_feng')
retarget(q, 'xiangyang_market', '去襄阳·马市，帮孔拾月把那三条船的账对平',
         '去襄阳·马市，帮孔拾月把那三条船的账对平')
liandong(q, '船帮外侧的旧漆下铲过一道，铲痕里还认得出半个编号。管船册的说，这编号的船，洛阳官仓的出仓单上也有。',
         '襄阳', 'clue_xiangyang')
d69['quests'][q['id']] = q

# 成都：秤砣上那点尘（缺角的烙印）
q = quest_from_pool('hk_npcv_237_cheng')
retarget(q, 'chengdu_lane', '陪李无咎去成都·竹巷，收一批抵账的旧货',
         '陪李无咎去成都·竹巷，收一批抵账的旧货')
# 原件首段 narrate 写的是义庄旧址，随迁址改写
q['stages'][-1]['effects'][0] = {"type": "narrate",
    "raw": "竹巷深处的旧货栈里，抵账的箱子摞了半墙，箱帮上全是各家的字号。"}
liandong(q, '其中一口旧货箱上烙着字号，烙铁缺了一角，烙出来的印也缺同一角。管市的官秤砣底上，缺的就是这一角。',
         '成都', 'clue_chengdu')
d69['quests'][q['id']] = q

# 成都次级：那口刀伤（只迁目标，不加联动段）
q = quest_from_pool('hk_npcv_237_daoshang')
retarget(q, 'chengdu_market', '去成都·蜀锦市，打听那口刀路是谁的',
         '去成都·蜀锦市，打听那口刀路是谁的')
d69['quests'][q['id']] = q

# 姑苏：枫桥那个人贩子（零迁址，弯钩暗记联动段落在对质收口）
q = quest_from_pool('hk_npcv_223_meimei')
liandong(q, '对质完你才留意到，那条小船的帮内侧刻着一个弯钩，钩尾挑得老高。跟船的人低声说，走这记号的船，装的不止漕米。',
         '姑苏', 'clue_gusu')
d69['quests'][q['id']] = q

# ---------- 二、四 NPC 全量 actions（61 原件 + 双通道） ----------
NPC_ACTIONS = {
    'npcv_215': [
        gate_action('验官文', ['官文', '文书'], '门里的官文好使（门派咬合）', 'act2_ca_ledger', True,
            '你出示门里的官文。她扫了一眼，把盐引从灶口取下来：「门里的人懂行。你看这个。」',
            '盐引斜角上压着半枚骑缝印，印泥没按匀，弧口朝左。这个印，你在别处见过。'),
        gate_action('市上打听', ['打听', '盐铺'], '没门没派，就花口舌（散人路径）', 'act2_ca_ledger', False,
            '你在市上问了三个盐铺的伙计。最后一个压低声音：「她的引是真引，就是批引的衙门，去年换过印。」',
            '你照着新印旧印对了一遍。旧印按得不匀，弧口朝左。这个印，你在别处见过。'),
    ],
    'npcv_208': [
        gate_action('亮漕帖', ['漕帖', '帖子'], '门里的漕帖管用（门派咬合）', 'act2_xy_ledger', True,
            '你亮出门里的漕帖。他掂了掂，领你去看船。三条船的船帮都用新漆盖过一遍。',
            '旧漆底下铲过一道，铲痕里还认得出半个编号。这编号的船，洛阳官仓的出仓单上也有。'),
        gate_action('帮船户搬货', ['搬货', '帮忙'], '没门没派，就出一膀子力气（散人路径）', 'act2_xy_ledger', False,
            '你帮船户搬了一下午货。管船的把烟杆朝船帮点了点：「别盯着看。这漆，上个月才盖的。」',
            '你趁搬货摸了一把船帮。旧漆底下铲过一道，铲痕里还认得出半个编号。这编号的船，洛阳官仓的出仓单上也有。'),
    ],
    'npcv_237': [
        gate_action('出示腰牌', ['腰牌', '牌子'], '腰牌一亮，他肯多说两句（门派咬合）', 'act2_cd_ledger', True,
            '你把腰牌搁在药柜上。他把帘子放下来，指了指墙角一口药箱：「箱子是别人抵账的，你自己看。」',
            '箱底烙着字号，烙铁缺了一角。管市的官秤砣底上，缺的是同一角。'),
        gate_action('替他出诊', ['出诊', '看病'], '没门没派，就替他跑一趟（散人路径）', 'act2_cd_ledger', False,
            '你替他跑了一趟城外出诊。回来的路上他忽然开口：「昨晚那口箱子，你多看了一眼。看第二眼，就看出来了。」',
            '他把药箱掀开给你看。箱底烙着字号，烙铁缺了一角。管市的官秤砣底上，缺的是同一角。'),
    ],
    'npcv_223': [
        gate_action('调门里卷宗', ['卷宗', '调卷'], '门里的卷宗还能调出旧账（门派咬合）', 'act2_gs_ledger', True,
            '你回门里调了卷宗。十二年前的漕运案卷缺了一页，缺页的编号还在目录上。你把编号抄给了他。',
            '他照编号找到一条旧船。船帮内侧刻着弯钩，钩尾挑得老高。走这记号的船，装的不止漕米。'),
        gate_action('陪他守夜', ['守夜', '守着'], '没门没派，就陪他熬一夜（散人路径）', 'act2_gs_ledger', False,
            '你陪他在枫桥守了一夜。四更天有船过，帮上一点火都没点。他数完船，只说了一句：「这个记号，我见第三回了。」',
            '你顺着他的眼神看过去。船帮内侧刻着弯钩，钩尾挑得老高。走这记号的船，装的不止漕米。'),
    ],
}

for pid, extra in NPC_ACTIONS.items():
    actions = copy.deepcopy(n61[pid]['actions'])
    for a in extra:
        if not has_cmd(actions, a['cmd']):
            actions.append(a)
    d69['npcs'][pid] = {"id": pid, "actions": actions}

# ---------- 三、乙分支「请他作证」（蒋倦处，名头来源 +40 *） ----------
jiang = d69['npcs'].setdefault('npcv_174', {"id": "npcv_174", "actions": []})
if not has_cmd(jiang['actions'], '请他作证'):
    jiang['actions'].append({
        "cmd": "请他作证", "label": "请他作证", "keywords": ["作证", "名头"],
        "desc": "第一次有人替你说话（乙分支名头来源）",
        "cond": {"and": [
            {"flag": "act1_kept_silent"},
            {"questDone": "hk_npcv_174_tuntang"},
            {"notFlag": "act2_witness_done"},
        ]},
        "once": True,
        "effects": [
            {"type": "narrate", "raw": "你把独木桥那晚的事说了一半，就停住了。有些话，你说三回，没有人应过。"},
            {"type": "narrate", "raw": "蒋倦把算盘一推：「我信。仓里亏空那三个月，也没人信我。」他提笔写了一纸证词，按了自己的名。「拿去。往后江湖上再有人问起那晚，你是有名有姓有证的人。」"},
            {"type": "flag", "args": ["act2_witness_done"]},
            {"type": "+rep", "args": ["*", 40]},
        ],
    })

# ---------- 四、浮名 action（方证/冲虚，clue_count>=4） ----------
FLOAT_N1 = "你把几桩案子里见过的东西一样样摆开：弧口朝左的骑缝印，铲痕里的半个船号，缺了角的烙印，帮上的弯钩。"
FLOAT_N2 = "「这几桩案子搁在一起看，少的东西是同一路人拿走的。」他把一个名字写在你掌心，随即抹平，「名字记在心里，别落在纸上。经手的人，站得比你想象的高。」"
for pid in ('shaolin_fangzheng', 'wudang_chongxu'):
    e = d69['npcs'].setdefault(pid, {"id": pid, "actions": []})
    if not has_cmd(e['actions'], '问那路人的名头'):
        e['actions'].append({
            "cmd": "问那路人的名头", "label": "问那路人的名头", "keywords": ["内鬼", "名头"],
            "desc": "几处案子凑到一起，那个名字自己浮上来",
            "cond": {"and": [
                {"var": "clue_count", ">=": 4},
                {"notFlag": "act2_mole_named"},
            ]},
            "once": True,
            "effects": [
                {"type": "narrate", "raw": FLOAT_N1},
                {"type": "narrate", "raw": FLOAT_N2},
                {"type": "flag", "args": ["act2_mole_named"]},
            ],
        })

# ---------- 五、第一批两案门派通道补 contrib（L2 咬合） ----------
for pid, cmd in (('npcv_174', '亮腰牌'), ('npcv_091', '问门里的差事')):
    a = next(a for a in d69['npcs'][pid]['actions'] if a['cmd'] == cmd)
    if not any(e.get('type') == 'contrib' for e in a['effects']):
        idx = next(i for i, e in enumerate(a['effects']) if e.get('type') == 'sys')
        a['effects'].insert(idx, {"type": "contrib", "args": ["本门", 40]})

# ---------- 六、思过崖门槛（or 形：认痕前自由，认痕后须名头） ----------
d69['rooms']['huashan_qingke'] = {
    "id": "huashan_qingke",
    "exits": {
        "w": {
            "to": "huashan_siguoya",
            "cond": {"or": [
                {"notFlag": "act1_recognized"},
                {"and": [
                    {"skill": "basic_sword", ">=": 30},
                    {"rep": "*", ">=": 80},
                ]},
            ]},
            "msg": "守崖的弟子横剑拦住：「思过崖是本门清修地。你的名头，江湖上还没人提过。」",
            "say": "守崖的弟子横剑拦住：「思过崖是本门清修地。你的名头，江湖上还没人提过。」他朝山下偏了偏头，「擂台上赢几场，或者替人走一趟镖，把名字挣出来，再来。」",
            "travel": "守崖的弟子打量你两眼，侧身让开：「名头响的人上了崖，也清静不了几天。请。」",
        }
    },
}

# ---------- 七、40_npcs 落点迁移 ----------
n40['npcv_215']['room'] = 'changan_market'
n40['npcv_208']['room'] = 'xiangyang_market'
n40['npcv_208']['title'] = '漕头'
n40['npcv_237']['room'] = 'chengdu_market'
# npcv_223 零迁址（燕子坞不动）

# ---------- 八、_note 更新 ----------
d69['_note'] = ("S3 卷二骨架（design/95 §一/§三/§八）。第一批（2026-10-15）：洛阳官仓案、衙门府箱案走通全链 + 卷二入口接引。"
    "第二批（2026-10-16）：长安盐引案/襄阳船案/成都秤砣案/姑苏人贩案同款改造（目标迁址 changan_market/xiangyang_market/"
    "chengdu_lane、姑苏零迁址；收口联动段+clue flag+incvar clue_count+效果级 +rep 60），成都次级案刀伤随迁 chengdu_market；"
    "四 NPC 双通道咬合 action（门派通道含 contrib 本门 40），第一批两案门派通道补 contrib；"
    "乙分支「请他作证」（蒋倦处，act1_kept_silent+tuntang，+40 * rep，act2_witness_done）；"
    "浮名 action（方证/冲虚，clue_count>=4 且 notFlag act2_mole_named，门槛维持 95 口径不上调）；"
    "思过崖门槛 or 形（notFlag act1_recognized 或 [basic_sword>=30 且 rep*>=80]，95 稿 and 形直落会锁死 act1 认痕，§八记档）。"
    "quest/npc 按 id 深合并、rooms.exits 按键合并、actions 数组整段声明（承接 61 原有全部条目）。"
    "声望挂点说明：commands.js:5852 的 repGainOnQuest 挂在 NPC def 上，同 NPC 多案会重复加成，故全部以收口效果级 '+rep' 落。")

# ---------- 断言 ----------
assert len([k for k in d69['quests'] if k.endswith('yanyin')]) == 1
for clue in ('clue_changan', 'clue_xiangyang', 'clue_chengdu', 'clue_gusu'):
    qid = {'clue_changan': 'hk_npcv_215_yanyin', 'clue_xiangyang': 'hk_npcv_208_feng',
           'clue_chengdu': 'hk_npcv_237_cheng', 'clue_gusu': 'hk_npcv_223_meimei'}[clue]
    eff = d69['quests'][qid]['stages'][-1]['effects']
    assert any(e.get('type') == 'flag' and e.get('args', [None])[0] == clue for e in eff), clue
    assert any(e.get('type') == 'incvar' for e in eff), qid
    assert any(e.get('type') == '+rep' for e in eff), qid
for pid in NPC_ACTIONS:
    a69 = d69['npcs'][pid]['actions']
    src_cmds = [a['cmd'] for a in n61[pid]['actions']]
    assert all(any(a['cmd'] == c for a in a69) for c in src_cmds), f"{pid} 61 原件缺失"
    assert sum(1 for a in a69 if a.get('cond', {}).get('hasSect')) == 1, pid
    assert sum(1 for a in a69 if a.get('cond', {}).get('noSect')) == 1, pid
    assert any(any(e.get('type') == 'contrib' for e in a['effects'])
               for a in a69 if a.get('cond', {}).get('hasSect')), f"{pid} 门派通道缺 contrib"
# contrib 补挂断言
for pid, cmd in (('npcv_174', '亮腰牌'), ('npcv_091', '问门里的差事')):
    a = next(a for a in d69['npcs'][pid]['actions'] if a['cmd'] == cmd)
    assert any(e.get('type') == 'contrib' for e in a['effects'])
# 作证 / 浮名断言
w = next(a for a in d69['npcs']['npcv_174']['actions'] if a['cmd'] == '请他作证')
assert any(e.get('type') == '+rep' and e['args'] == ['*', 40] for e in w['effects'])
for pid in ('shaolin_fangzheng', 'wudang_chongxu'):
    f = next(a for a in d69['npcs'][pid]['actions'] if a['cmd'] == '问那路人的名头')
    assert f['cond'] == {"and": [{"var": "clue_count", ">=": 4}, {"notFlag": "act2_mole_named"}]}
    assert any(e.get('type') == 'flag' and e['args'] == ['act2_mole_named'] for e in f['effects'])
# 思过崖 or 形断言
wex = d69['rooms']['huashan_qingke']['exits']['w']
assert 'or' in wex['cond'] and wex.get('msg') and wex.get('say') and wex.get('travel')
# 40_npcs 断言
assert n40['npcv_215']['room'] == 'changan_market'
assert n40['npcv_208']['room'] == 'xiangyang_market' and n40['npcv_208']['title'] == '漕头'
assert n40['npcv_237']['room'] == 'chengdu_market'
assert n40['npcv_223']['room'] == 'gusu_yanzi'

# ---------- 写盘（口径：69 indent=2 尾换行 LF；40_npcs indent=2 无尾换行 LF） ----------
from _canon_write import write_canon
write_canon('game/data/69_juan2_s3.json', d69)
with open('game/data/40_npcs.json', 'w', encoding='utf-8', newline='') as f:
    f.write(json.dumps(d40, ensure_ascii=False, indent=1))

# 复读校验 + LF 核查
for p in ('game/data/69_juan2_s3.json', 'game/data/40_npcs.json'):
    s = open(p, 'rb').read()
    assert b'\r' not in s, p
    json.loads(s.decode('utf-8'))
s40 = open('game/data/40_npcs.json', encoding='utf-8').read()
assert not s40.endswith('\n'), '40_npcs 不应带尾换行'
nq = len(d69['quests']); nn = len(d69['npcs'])
print(f"OK: 69 quests={nq} npcs={nn} rooms={len(d69['rooms'])}; 40_npcs 迁移 3 处 + 标题 1 处")
