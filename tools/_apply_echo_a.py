#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_echo_a.py —— 回响 A 层（design/110，游有方 2026-10-18）
----------------------------------------------------------------
A1 BARE 6 条：交任务当场补专属 say（写进 quest.rewards 末尾）。
A2 court/neutral 两条 write-only 旗补消耗点（长安街 / 洛阳集市）。
A3 q_main_jianghu 世界级回响（东市老茶馆）。
A4 门派入门/进阶 13 条：8 个门派各加一个「问门中近况」动作，内部按 questdone 分支。
A5 奇遇 q_siguya_sword（思过崖「再看剑痕」）。

⚠️ 挂房纪律：落点必须挂「最后定义该房且带 actions 键」的分片：
   shaolin_daxiong→65 · taohuadao_qingyin→66 · huashan_siguoya→63 · jn_teahouse→62
   其余（huashan_zhengqi/wudang_zixiao/emei_jinding/gaibang_po_miao/miaojiang_sheng/
   dali_wangfu/changan_street/luoyang_market）→50_map
红线：不动 248 条 QUIET 原文；新动作 cond 只读 questdone/结局旗；零 rewards；
     同房不撞词、不被前面的动作吞（cmd 不用「看」开头）。
幂等：结构比对，两连跑 OK。
"""
import json, io, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(fn, j):
    with io.open(os.path.join(DATA, fn), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
        f.write('\n')

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}

dirty = set()
docs = {}

def doc(fn):
    if fn not in docs:
        docs[fn] = read(fn)
    return docs[fn]

# =====================================================================
# A1 · BARE 6：rewards 补专属台词
# =====================================================================
REWARD_SAY = {
  'q_huashan_sword_test': '岳不群收了剑谱，只说一句：「五个人，五条路。山上的师弟都在看你怎么走回来的。」',
  'q_huashan_spy': '岳不群听完，把窗推开一条缝：「黑木崖上的事，你看到的部分，够我写一封信了。」',
  'q_yijinjing': '方证把扫帚递给你：「筋骨熬出来，只是把门推开。经在里头，人在外头。」',
  'q_liumai': '段誉收起折扇：「六脉不是六把剑。是你心里那口气，分作六道。」',
  'q_bounty_bandit': '城门守卫点了银子，一枚一枚点完：「五十两，一文不少。城南山道今夜能睡安稳觉了。」',
  'q_bounty_wolf': '采药翁把三贴药塞给你：「狼少了，樵夫敢走黑松林。这三贴你带着。」',
}
for qid, line in REWARD_SAY.items():
    for fn in ('60_quests.json',):
        d = doc(fn)
        q = (d.get('quests') or {}).get(qid)
        if not q:
            continue
        rw = q.setdefault('rewards', [])
        if any(e.get('type') == 'say' and e.get('raw') == line for e in rw):
            continue
        rw.append(say(line))
        dirty.add(fn)

# =====================================================================
# A2/A3/A4/A5 · 回响动作
# =====================================================================
def branch(flag, narrs, says=()):
    eff = [narr(t) for t in narrs] + [say(t) for t in says]
    return {"type": "cond", "if": {"flag": flag}, "then": eff}

ECHOES = [
  # ---- A2 court / neutral ----
  ('50_map.json', 'changan_street', {
     "cmd": "听街上人说话", "label": "听街上人说话", "keywords": ["街上人", "茶棚", "翻案"],
     "desc": "在朱雀大街上听人闲话",
     "cond": {"flag": "act_court_done"},
     "effects": [
       narr("茶棚里两个人压着嗓子说话，说的是大理寺把一桩旧案的第一句重写了。"),
       say("「听说翻案的人不是官。」「那是什么人？」「不知道。听说姓什么都不肯说。」"),
       narr("茶博士过来添水，添到一半停住，看了你一眼，把壶嘴挪开了。"),
     ]}),
  ('50_map.json', 'luoyang_market', {
     "cmd": "听摊上人说话", "label": "听摊上人说话", "keywords": ["摊上人", "收摊", "账"],
     "desc": "在集市上听摊主闲话",
     "cond": {"flag": "act_neutral_done"},
     "effects": [
       narr("摊主收摊时提起一个没有门帖的人，说那人把两边的账算明白了，算完就走。"),
       say("「叫什么来着……」他把秤砣放进箱子，「忘了。就记得他没带腰牌。」"),
       narr("他把布一块一块卷起来，多看了你一眼。"),
     ]}),
  # ---- A3 q_main_jianghu ----
  ('62_shops.json', 'jn_teahouse', {
     "cmd": "听人说起你", "label": "听人说起你", "keywords": ["你的段子", "说起你", "听人提起"],
     "desc": "在茶馆里听听人在传什么",
     "cond": {"flag": "questdone_q_main_jianghu"},
     "effects": [
       narr("说书人把醒木一拍，开了个新段子。段子里那个少年，从一个不认得的来路来，怀里揣着一封不知谁给的信。"),
       narr("茶客追问结局。他把醒木收进袖子：「下回分解。」"),
       say("邻座的老人看了你一眼，什么也没说，给你添了半盏茶。"),
     ]}),
  # ---- A4 门派（8 处 / 覆盖 13 条） ----
  ('50_map.json', 'huashan_zhengqi', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "门里", "师门"],
     "desc": "问问门里近来如何",
     "cond": {"or": [{"flag": "questdone_q_huashan_entry"},
                     {"flag": "questdone_q_huashan_sword_test"},
                     {"flag": "questdone_q_huashan_spy"}]},
     "effects": [
       {"type": "cond", "if": {"flag": "questdone_q_huashan_entry"}, "then": [
          narr("正气堂西侧的木架新添了一块名牌，字是新刻的，边角还没磨圆。"),
          say("岳不群：「门里添了个人，饭要多做一份。」")], "else": []},
       {"type": "cond", "if": {"flag": "questdone_q_huashan_sword_test"}, "then": [
          narr("剑坪上几个师弟在比划，比的是你下山时用过的那几式，学得不像。"),
          say("岳不群：「他们只看你出剑，没看你收剑。」")], "else": []},
       {"type": "cond", "if": {"flag": "questdone_q_huashan_spy"}, "then": [
          narr("岳不群听你提黑木崖，把茶碗盖按住了，没有揭。"),
          say("「那一趟，你没有留尾巴吧。」他声音压得比平时低半分。")], "else": []},
     ]}),
  ('65_mainline_act3.json', 'shaolin_daxiong', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "门里", "早课"],
     "desc": "问问寺里近来如何",
     "cond": {"or": [{"flag": "questdone_q_shaolin_entry"}, {"flag": "questdone_q_yijinjing"}]},
     "effects": [
       {"type": "cond", "if": {"flag": "questdone_q_shaolin_entry"}, "then": [
          narr("知客僧翻名册翻到你的法号，手指在上面停了一下。"),
          say("「往后早课，你的位置在第三排东头。」")], "else": []},
       {"type": "cond", "if": {"flag": "questdone_q_yijinjing"}, "then": [
          narr("大雄宝殿后头的青砖磨得更亮了，扫地的人换过。"),
          say("方证：「铜人阵过了，往后扫地也算修行。」")], "else": []},
     ]}),
  ('50_map.json', 'wudang_zixiao', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "门规", "道童"],
     "desc": "问问观里近来如何",
     "cond": {"flag": "questdone_q_wudang_entry"},
     "effects": [
       narr("紫霄宫的道童又把门规背了一遍，背到「不与人争」时看了你一眼。"),
       say("冲虚：「规矩是给守得住的人定的。」"),
     ]}),
  ('50_map.json', 'emei_jinding', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "师姐", "粗碗"],
     "desc": "问问山上近来如何",
     "cond": {"flag": "questdone_q_emei_entry"},
     "effects": [
       narr("金顶的师姐们递茶换了粗碗，不再用待客的那一套。"),
       say("灭绝：「峨眉不留闲人，也不赶做过事的人。」"),
     ]}),
  ('50_map.json', 'gaibang_po_miao', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "帮里", "窝头"],
     "desc": "问问破庙里的近况",
     "cond": {"or": [{"flag": "questdone_q_gaibang_entry"}, {"flag": "questdone_q_xianglong"}]},
     "effects": [
       {"type": "cond", "if": {"flag": "questdone_q_gaibang_entry"}, "then": [
          narr("破庙的佛座底下有人留了半个窝头，用油纸包着，包得很整齐。"),
          say("洪七公：「帮里的规矩，做过事的人先吃。」")], "else": []},
       {"type": "cond", "if": {"flag": "questdone_q_xianglong"}, "then": [
          narr("洪七公拍你肩膀时手上有油，拍完在自己衣襟上擦了擦。"),
          say("「降龙练到这个火候，撑腰比打人更用得上。」")], "else": []},
     ]}),
  ('50_map.json', 'miaojiang_sheng', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "圣堂", "草籽"],
     "desc": "问问圣堂里的近况",
     "cond": {"flag": "questdone_q_miao_entry"},
     "effects": [
       narr("圣堂的梁上挂着一串干草，风过时响得像小铃。"),
       say("蓝凤凰：「那包草籽你喂着看，长得活，才算数。」"),
     ]}),
  ('50_map.json', 'dali_wangfu', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "王府", "侧门"],
     "desc": "问问王府里的近况",
     "cond": {"or": [{"flag": "questdone_q_dali_entry"}, {"flag": "questdone_q_liumai"}]},
     "effects": [
       {"type": "cond", "if": {"flag": "questdone_q_dali_entry"}, "then": [
          narr("王府的下人改了称呼，不再叫「那位客人」。"),
          say("段誉：「往后你出入走侧门就行，不必再通报。」")], "else": []},
       {"type": "cond", "if": {"flag": "questdone_q_liumai"}, "then": [
          narr("牟尼堂的石壁前留了一盏灯，灯芯剪得很短，够烧到天亮。"),
          say("段誉：「六脉那道气，你现在心里有数了吧。」")], "else": []},
     ]}),
  ('66_mainline_act45.json', 'taohuadao_qingyin', {
     "cmd": "问门中近况", "label": "问门中近况", "keywords": ["门中近况", "药方", "岛上"],
     "desc": "问问岛上近来的事",
     "cond": {"flag": "questdone_q_taohua_entry"},
     "effects": [
       narr("清音洞的石桌上摊着一张药方，背面写了几个字，墨还新。"),
       say("黄药师没有抬头：「名字写在药方背面的，岛上只有三个人。」"),
     ]}),
  # ---- A5 奇遇 ----
  ('63_mainline_act1.json', 'huashan_siguoya', {
     "cmd": "再看那面墙", "label": "再看一眼剑痕", "keywords": ["那面墙", "末一笔", "收笔"],
     "desc": "再看一眼石壁上的剑痕",
     "cond": {"flag": "questdone_q_siguya_sword"},
     "effects": [
       narr("石壁上的剑痕还是那样，深浅不一。"),
       narr("你这次看出来：最末那一笔收得仓促，像是写到一半被人叫走了。"),
       say("令狐冲在洞口等你：「你又看出一层？这崖上的事，越看越多。」"),
     ]}),
]

def upsert(room, want):
    acts = room.setdefault('actions', [])
    hit = [a for a in acts if a.get('cmd') == want['cmd']]
    if not hit:
        acts.append(want)
        return True
    if json.dumps(hit[0], ensure_ascii=False, sort_keys=True) != json.dumps(want, ensure_ascii=False, sort_keys=True):
        hit[0].clear(); hit[0].update(want)
        return True
    return False

for fn, rid, act in ECHOES:
    d = doc(fn)
    room = d['rooms'][rid]
    if upsert(room, act):
        dirty.add(fn)

# ---------------- 落盘 ----------------
for fn in sorted(dirty):
    write(fn, docs[fn])
print('改动分片:', sorted(dirty) or '（无）')

# =====================================================================
# 断言
# =====================================================================
ECHO_FLAGS = ['act_court_done', 'act_neutral_done', 'questdone_q_main_jianghu',
              'questdone_q_huashan_entry', 'questdone_q_huashan_sword_test', 'questdone_q_huashan_spy',
              'questdone_q_shaolin_entry', 'questdone_q_yijinjing',
              'questdone_q_wudang_entry', 'questdone_q_emei_entry',
              'questdone_q_gaibang_entry', 'questdone_q_xianglong',
              'questdone_q_miao_entry', 'questdone_q_dali_entry', 'questdone_q_liumai',
              'questdone_q_taohua_entry', 'questdone_q_siguya_sword']
allblob = ''
for fn in os.listdir(DATA):
    if fn.endswith('.json'):
        allblob += io.open(os.path.join(DATA, fn), encoding='utf-8-sig').read()
for f in ECHO_FLAGS:
    assert f in allblob, '回响旗未落地: ' + f

# 1) 每个回响动作都落且 cond 只读旗
for fn, rid, act in ECHOES:
    v = read(fn)['rooms'][rid]['actions']
    hit = [a for a in v if a.get('cmd') == act['cmd']]
    assert len(hit) == 1, f'{rid} 回响动作没落或重复'
    assert hit[0]['cond'] == act['cond'], f'{rid} cond 不符'
    assert 'rewards' not in json.dumps(hit[0], ensure_ascii=False), f'{rid} 回响带 rewards'

# 2) BARE 6 的 rewards 有 say
for qid, line in REWARD_SAY.items():
    q = read('60_quests.json')['quests'][qid]
    assert any(e.get('type') == 'say' and e.get('raw') == line for e in q['rewards']), qid + ' 无专属台词'

# 3) 同房不撞词、不被吞
for fn, rid, act in ECHOES:
    acts = read(fn)['rooms'][rid]['actions']
    idx = {a.get('cmd'): i for i, a in enumerate(acts)}
    mine = {act['cmd']} | set(act['keywords'])
    for a in acts:
        if a.get('cmd') == act['cmd']:
            continue
        other = {a.get('cmd', '')} | set(a.get('keywords') or [])
        assert not (mine & {x for x in other if x}), f'{rid} 撞词: {mine & other}'
        if idx[a.get('cmd')] < idx[act['cmd']]:
            for k in (a.get('keywords') or []):
                assert not (k and k != act['cmd'] and k in act['cmd']), \
                    f'{rid} 既有「{a.get("cmd")}」keyword「{k}」会吞「{act["cmd"]}」'

# 3b) 新回响文本红线：无破折号 / 无对偶 / 无朱雀偏好词
for fn, rid, act in ECHOES:
    blob = json.dumps(act, ensure_ascii=False)
    assert '——' not in blob, f'{rid} 破折号'
    import re as _re
    assert not _re.search(r'不是[^，]{1,14}，(?:而是|是)', blob), f'{rid} 对偶'
    for w in ('最后', '落地', '死死', '猛地', '稳稳'):
        assert w not in blob, f'{rid} 偏好词: {w}'

# 4) 红线：248 QUIET 原文未动（只查 quest 的 desc 与 stages 未被改写——用 HEAD 对比）
import subprocess
for qf in ('60_quests.json',):
    r = subprocess.run(['git', 'show', f'HEAD:game/data/{qf}'], cwd=ROOT,
                       capture_output=True, text=True, timeout=30)
    if r.returncode == 0 and r.stdout.strip():
        old = json.loads(r.stdout)['quests']
        now = read(qf)['quests']
        changed = [q for q in old if q in now and
                   json.dumps({k: v for k, v in old[q].items() if k != 'rewards'}, sort_keys=True, ensure_ascii=False) !=
                   json.dumps({k: v for k, v in now[q].items() if k != 'rewards'}, sort_keys=True, ensure_ascii=False)]
        assert not changed, '除 rewards 外有 quest 被改: ' + str(changed[:3])

print(f'断言全过：{len(ECHOES)} 处回响落地 / {len(REWARD_SAY)} 条 BARE 台词 / 17 个回响旗有读者 / '
      '不撞词不吞词 / QUIET 原文未动')
