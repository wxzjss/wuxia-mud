#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_j2b_seg2.py —— 批4·卷二第二批 分段2/4（design/97 §九.4 #4，游有方 2026-10-16）
----------------------------------------------------------------
段2 六案（61 池茶馆文场组，口径同段1）：
  杜听涛(元若那四十七两)/柳三弦(说书人那张嘴·giver 归位)/
  和归鸿(偷换的那坛酒)/鲁半夏(雅间里那句醉话)/庞南枝(半张契)/鲁拂衣(樊湘那一页)
特记：说书案 npc/giver 归位 hk_storyteller（柳三弦）——97 落位表「+hk_storyteller」
  本意；quest id 不变，40_npcs 画像 hook 绑 quest id 不绑 giver，零连带。
幂等：内容比对 + fixup 段，两连跑 OK。
"""
import json, os, io, copy

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def read(p):
    with io.open(p, 'r', encoding='utf-8-sig') as f:
        return json.load(f)

def write(p, j):
    from _canon_write import write_canon as _wc
    _wc(p, j)
P61 = os.path.join(ROOT, 'game', 'data', '61_sidequests.json')
P50 = os.path.join(ROOT, 'game', 'data', '50_map.json')

d61, d50 = read(P61), read(P50)
dirty61 = dirty50 = False

LOCK_J2 = {"flag": "jiuye_done", "name": "卷二·风起",
           "msg": "这桩事还没到能见底的时候。东边的路没开，话就还没处说。"}

def go(stage_id, room, hint):
    return {"id": stage_id, "kind": "room", "key": room, "count": 1,
            "var": stage_id, "desc": hint}

def narr(t): return {"type": "narrate", "raw": t}
def say(t):  return {"type": "say", "raw": t}
def menu(t): return {"type": "menu", "raw": t}

# =====================================================================
# 案 7 · 杜听涛「元若那四十七两」
# =====================================================================
Q = d61['quests']['hk_npcv_065_siqiliang']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 三年的账（南巷和放处）
        "desc": "去东市·南巷，翻和放经手的借据找那笔的底",
        "targets": [go("hk_npcv_065_siqiliang_go1", "jn_market_south", "去南巷查借据底档")],
        "next": 2,
        "effects": [
          narr("和放的借据按年扎捆。杜听涛那一笔翻出来，借据背面有一行小字：代茶资，无息。"),
          say("和放把借据按回去：「放贷的见惯了欠钱的。欠三年不跑的，我只见过他一个。」"),
          menu("借据这一页|原样借来对一遍，明早还回>+exp:130;+karma:5;flag:j2b_siqi_note;;出五十文买通小厮多问两句>-money:50;+pot:40;flag:j2b_siqi_note")
        ]
      },
      {  # s2 修桥的官册（架阁库）
        "desc": "去衙门·架阁库，查杜听涛当年捐修石桥的名册",
        "targets": [go("hk_npcv_065_siqiliang_go2", "jn_yamen_arch", "去架阁库查官册")],
        "next": 3,
        "effects": [
          narr("架阁库里那本捐修名册还在。杜听涛的名字排在第七，捐银十二两，落款是四十年前。"),
          say("看库的老吏认得这个名字：「城南那座石桥就是他修的。桥如今还走着人。」"),
          menu("官册这一页|抄下来，等会儿给他看>+rep:朝廷:10;+exp:130;flag:j2b_siqi_guan;;记在心里，不落纸>+pot:50;flag:j2b_siqi_guan")
        ]
      },
      {  # s4 收束（老茶馆）
        "desc": "回东市·老茶馆，让这两个老头把四十七两说开",
        "targets": [go("hk_npcv_065_siqiliang_go3", "jn_teahouse", "回老茶馆回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("你把借据背面那行小字念给两个人听。元若听完先笑了：「我还当他不记得。他连利息都替我免了。」"),
          say("杜听涛把那只磕了口的茶碗推过去：「茶钱四十七两，早备下了。差的不是银子，是个台阶。」"),
          menu("这个台阶|把话带到，让他们自己下>+favor:npcv_065:35;incvar:favor_npcv_065:35;+pot:50;+exp:150;flag:j2b_siqi_done;;替他垫一半，今天就清>-money:24;+karma:12;+exp:130;flag:j2b_siqi_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 8 · 柳三弦「说书人那张嘴」（giver 归位 hk_storyteller）
# =====================================================================
Q = d61['quests']['hk_npcv_009_shuoshu']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['npc'] = 'hk_storyteller'
    Q['giver'] = 'hk_storyteller'
    Q['require'] = {"and": [{"questDone": "hk_npcv_009_baizi"}, {"flag": "jiuye_done"}]}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 词里的名字（市集熊时处）
        "desc": "去江南城·市集，跟熊时对词里那三个名字",
        "targets": [go("hk_npcv_009_shuoshu_go1", "jiangnan_market", "去市集找熊时对名字")],
        "next": 2,
        "effects": [
          narr("熊时的珠子拨到一半停下：「词里第三个名字，是我念给他的。欠我的那笔，他拿去翻本，本没了。」"),
          say("「我不识字。名字进了他的词，比进了衙门的册子还稳。」"),
          menu("这三个名字|替熊时把话递回茶馆，指名道姓>+favor:npcv_009:15;incvar:favor_npcv_009:15;+exp:140;flag:j2b_shuoshu_name;;劝他把最末一个划了，给条活路>+karma:8;+exp:120;flag:j2b_shuoshu_name")
        ]
      },
      {  # s2 词本的字（翰墨斋）
        "desc": "去江南城·翰墨斋，认一认柳三弦那本词的字是谁抄的",
        "targets": [go("hk_npcv_009_shuoshu_go2", "jn_bookshop", "去翰墨斋认笔迹")],
        "next": 3,
        "effects": [
          narr("词本的字抄得工整。鲁拂衣看了一眼就认出来：「这手字出自一个落第的秀才。他抄一页，换三文钱。」"),
          say("「词是他写的，事是真事。抄词的人不管真不真，管字数。」"),
          menu("词本的来历|听他把抄词人的下落讲完>+exp:140;flag:j2b_shuoshu_book;;买一册词本回去慢慢对>-money:30;+pot:40;flag:j2b_shuoshu_book")
        ]
      },
      {  # s4 收束（老茶馆）
        "desc": "回东市·老茶馆，听柳三弦给这张嘴一个去处",
        "targets": [go("hk_npcv_009_shuoshu_go3", "jn_teahouse", "回老茶馆收尾")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("柳三弦把三弦调了个弦。「这张嘴吃的是旧事的饭。名字进了词，就取不出来了。词是活的，比人活得久。」"),
          say("「你要真替那些人求情，别找我。让他们把钱还了，我第二天就把词改了。」"),
          menu("这张嘴|请他留半句余地，不把话说死>+favor:npcv_009:25;incvar:favor_npcv_009:25;+karma:10;+exp:150;flag:j2b_shuoshu_done;;让词接着唱，债户自己掂量>+rep:*:10;+exp:140;favor:npcv_009:-15;incvar:favor_npcv_009:-15;flag:j2b_shuoshu_done")
        ]
      }
    ]
    dirty61 = True

# giver 归位连带：npcv_009 去挂载，「听说书」动作挪给柳三弦（narrate verbatim 挪）
n9 = d61['npcs'].get('npcv_009')
if n9:
    if isinstance(n9.get('quests'), list) and 'hk_npcv_009_shuoshu' in n9['quests']:
        n9['quests'] = [q for q in n9['quests'] if q != 'hk_npcv_009_shuoshu']
        dirty61 = True
    acts9 = n9.get('actions') or []
    keep = [a for a in acts9 if a.get('cmd') != '听说书']
    if len(keep) != len(acts9):
        moved = [a for a in acts9 if a.get('cmd') == '听说书'][0]
        n9['actions'] = keep
        st = d61['npcs'].setdefault('hk_storyteller', {})
        if not isinstance(st.get('quests'), list):
            st['quests'] = ['hk_npcv_009_shuoshu']
        ast = st.setdefault('actions', [])
        if not any(a.get('cmd') == '问柳三弦' for a in ast):
            # cmd 改「问柳三弦」：原「听说书」会被 jn_teahouse 房动作 listen 说书
            # 的 keywords（说书）抢先命中（questKeyword 先扫 room.actions），
            # 玩家永远吃「暂时没有更多可做的」。keywords 全避开「说书」字样。
            moved = dict(moved)
            moved['cmd'] = '问柳三弦'
            moved['label'] = '向柳三弦打听说书的事'
            moved['keywords'] = ['问柳三弦', '柳三弦旧事', '打听旧事']
            ast.append(moved)
        dirty61 = True
# fixup：已落盘的「听说书」动作（幂等刷成改名版）
_st = d61['npcs'].get('hk_storyteller') or {}
for _a in (_st.get('actions') or []):
    if _a.get('cmd') == '听说书':
        _a['cmd'] = '问柳三弦'
        _a['label'] = '向柳三弦打听说书的事'
        _a['keywords'] = ['问柳三弦', '柳三弦旧事', '打听旧事']
        dirty61 = True

# =====================================================================
# 案 9 · 和归鸿「偷换的那坛酒」
# =====================================================================
Q = d61['quests']['hk_npcv_074_qian']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"and": [{"questDone": "hk_npcv_074_yajian"}, {"flag": "jiuye_done"}]}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 镖行的账（东市大街乐知处）
        "desc": "去东市·大街，看镖行的账上那趟误期记了什么",
        "targets": [go("hk_npcv_074_qian_go1", "jn_market_main", "去大街看镖行账")],
        "next": 2,
        "effects": [
          narr("乐知把那趟的账翻出来。误期三天的罚银记了，压货的利息记了，栏外还有一行小字：酒。"),
          say("「货单上没有酒。多出来的这一笔，是护镖的兄弟们凑钱添的。添给谁，账上不能写。」"),
          menu("账上这一行|照账念给他听，一个字不改>+exp:140;+karma:5;flag:j2b_qian_zhang;;替他把那一行遮过去>-money:30;+pot:40;flag:j2b_qian_zhang")
        ]
      },
      {  # s2 那坛酒的来路（醉仙楼）
        "desc": "去东市·醉仙楼，查那晚被换掉的酒是哪来的",
        "targets": [go("hk_npcv_074_qian_go2", "jn_wine_house", "去醉仙楼查酒")],
        "next": 3,
        "effects": [
          narr("店小二记得那坛酒：「那晚有人来买一坛陈酿，指名要最烈的。买主付了双倍的价，只问了一句：几点关城门。」"),
          say("「我们只卖酒，不卖别的话。可那坛酒抬出去的时候，我瞧见买主的靴子，是衙门里的样式。」"),
          menu("买主的靴子|多给二十文，把模样问细>-money:20;+exp:130;flag:j2b_qian_jiu;;不追问，记下关城门的时辰>+exp:120;+pot:40;flag:j2b_qian_jiu")
        ]
      },
      {  # s4 收束（老茶馆）
        "desc": "回东市·老茶馆，把这个说法带到强秋那桌",
        "targets": [go("hk_npcv_074_qian_go3", "jn_teahouse", "回老茶馆交话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("和归鸿把那晚的事原原本本说了。强秋听完，端着茶碗半天没动。"),
          say("「误的镖我认赔，酒我不认。」强秋把碗搁下，「我等的不是赔罪，是这句实话。」"),
          menu("这个说法|当面把话带到，让两个人把梁子解了>+favor:npcv_081:30;incvar:favor_npcv_081:30;+karma:8;+exp:160;flag:j2b_qian_done;;替和归鸿把酒钱赔了，不说破是谁>-money:60;+favor:npcv_074:20;incvar:favor_npcv_074:20;+exp:130;flag:j2b_qian_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 10 · 鲁半夏「雅间里那句醉话」
# =====================================================================
Q = d61['quests']['hk_npcv_186_zuihua']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 夜里的帖子（刑房）
        "desc": "去衙门·刑房，看昨夜递进来的那张帖子",
        "targets": [go("hk_npcv_186_zuihua_go1", "jn_yamen_wt", "去刑房看帖子")],
        "next": 2,
        "effects": [
          narr("刑房的帖子簿上，昨夜递进来一张名帖，落款是个官讳。当值书吏说，人没等，帖留下了。"),
          say("「喝醉的人说什么，衙门不录。可帖子递到刑房，就由不得衙门了。」"),
          menu("那张帖子|抄下落款的官讳>+rep:朝廷:8;+exp:140;flag:j2b_zuihua_tie;;不碰帖子，只记时辰>+pot:50;flag:j2b_zuihua_tie")
        ]
      },
      {  # s2 别人的耳朵（老茶馆）
        "desc": "去东市·老茶馆，听茶客里有没有第二双耳朵",
        "targets": [go("hk_npcv_186_zuihua_go2", "jn_teahouse", "去老茶馆探口风")],
        "next": 3,
        "effects": [
          narr("茶馆里果然有人提同一句醉话，说的人压着嗓子，听的人不接茬。角落里坐着个生面孔，茶续了三回，人没走。"),
          say("跑堂的收碗时低声说：「那位爷这几天天天来。点的都是最便宜的茶，坐的都是最贵的时辰。」"),
          menu("那双耳朵|散三十文，让跑堂的嘴严些>-money:30;+karma:8;+exp:130;flag:j2b_zuihua_er;;凑近听两句，记住长相>+exp:140;flag:j2b_zuihua_er")
        ]
      },
      {  # s4 收束（醉春楼花厅）
        "desc": "回醉春楼·花厅，让鲁半夏自己拿主意",
        "targets": [go("hk_npcv_186_zuihua_go3", "jn_brothel_hall", "回花厅回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("鲁半夏听完，把酒盏终于放下了。「帖子、耳朵、醉话。三样凑齐，我这条命就不是捡来的了，是借来的。」"),
          say("「借来的东西，总有一天要还。你说，我现在还，还是等他们来收？」"),
          menu("这句话|替她把话烂在肚里，谁也不递>+favor:npcv_186:35;incvar:favor_npcv_186:35;+pot:50;+exp:160;flag:j2b_zuihua_done;;递给该收账的人，换她一条干净路>+rep:日月神教:15;+karma:-10;+exp:150;flag:j2b_zuihua_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 11 · 庞南枝「半张契」
# =====================================================================
Q = d61['quests']['hk_npcv_095_qi']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 另半张契（丐帮破庙）
        "desc": "去城西·破庙，看任停那半张契的下落",
        "targets": [go("hk_npcv_095_qi_go1", "gaibang_po_miao", "去破庙找任停的半张契")],
        "next": 2,
        "effects": [
          narr("佛座底下果然压着半张契，纸色比庞南枝那半张旧。两半的裂口对上，严丝合缝。"),
          say("和苍念了半句佛号：「住了七年，庙是家。契是纸。贫道只认得家，认不得纸。」"),
          menu("那半张契|只看裂口，不动原物>+exp:140;+karma:8;flag:j2b_qi_ken;;借走对档，明日归还>+exp:130;flag:j2b_qi_ken")
        ]
      },
      {  # s2 年份的墨（翰墨斋后堂）
        "desc": "去翰墨斋·后堂，请鲁拂衣验年份上那两笔的墨",
        "targets": [go("hk_npcv_095_qi_go2", "jn_study_1", "去后堂验墨")],
        "next": 3,
        "effects": [
          narr("鲁拂衣对着日头看了半晌。「契身的墨沉在纸里，年份那两个字的墨浮在面上。浮墨，至多五年。」"),
          say("「落款两百多年的道观，添了五年新的年份。添字的人不怕神佛，怕官府。」"),
          menu("验墨的结论|请她落一纸凭据，往后呈堂用得上>+exp:150;flag:j2b_qi_mo;;口头记住，不落纸面>+pot:50;flag:j2b_qi_mo")
        ]
      },
      {  # s4 收束（城隍庙）
        "desc": "回江南城·城隍庙，把两半契的去向交给庞南枝",
        "targets": [go("hk_npcv_095_qi_go3", "jiangnan_temple", "回城隍庙回话")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("庞南枝把两半契在石桌上拼起来，看了很久。「争了七年，争的是这一行浮墨。」"),
          say("「师父说莫争。我争了七年，到头来是该争的东西没争，不该争的争了七年。」"),
          menu("两半契|合在一起，还给破庙，庙归住的人>+favor:npcv_095:30;incvar:favor_npcv_095:30;+karma:10;+exp:160;flag:j2b_qi_done;;连验墨凭据一起呈衙门，公断>+rep:朝廷:15;+exp:150;favor:npcv_095:-15;incvar:favor_npcv_095:-15;flag:j2b_qi_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 案 12 · 鲁拂衣「樊湘那一页」
# =====================================================================
Q = d61['quests']['hk_npcv_036_juanzi']
if Q.get('stages') and Q['stages'][0].get('next') == 99:
    Q['require'] = {"flag": "jiuye_done"}
    Q['stages'][0]['next'] = 1
    Q['stages'] += [
      {  # s1 落第那年（白鹿书院）
        "desc": "去白鹿书院·讲堂，问夫子樊湘落第那一年的旧事",
        "targets": [go("hk_npcv_036_juanzi_go1", "jn_school", "去书院问旧年学籍")],
        "next": 2,
        "effects": [
          narr("夫子翻着旧学籍：「樊湘那年卷子被墨污了半页，按例誊抄复核。誊抄的卷子，没进过贡院。」"),
          say("「污卷是常有的事。少见的是，誊抄那一页后来自己长了腿。」"),
          menu("学籍这一册|翻誊抄那一页的存根>+exp:140;+pot:40;flag:j2b_juanzi_xue;;问誊抄经手人的名字>+exp:130;+karma:5;flag:j2b_juanzi_xue")
        ]
      },
      {  # s2 贡院的底（架阁库）
        "desc": "去衙门·架阁库，对贡院留底的那份副本",
        "targets": [go("hk_npcv_036_juanzi_go2", "jn_yamen_arch", "去架阁库对副本")],
        "next": 3,
        "effects": [
          narr("架阁库里那份副本找到了，纸角泡过水，字还在。誊抄卷与副本并排一放：文气一致，落笔却差着一个时辰。"),
          say("看库的老吏把两份卷子分开收好：「差一个时辰，就是两份卷子。两份卷子，就有一份是假的。」"),
          menu("两份卷子|并排抄一份对照，留个凭据>+rep:朝廷:8;+exp:140;flag:j2b_juanzi_fu;;只记差异，卷子原样归档>+exp:130;+pot:40;flag:j2b_juanzi_fu")
        ]
      },
      {  # s4 收束（翰墨斋后堂）
        "desc": "回翰墨斋·后堂，让鲁拂衣对那一页做个了断",
        "targets": [go("hk_npcv_036_juanzi_go3", "jn_study_1", "回后堂回了断")],
        "next": 99,
        "lock": dict(LOCK_J2),
        "effects": [
          narr("鲁拂衣把两处对好的结果听完，从书堆底下抽出那一页。「抄它的时候我不懂事。存着它的时候，我更不懂事。」"),
          say("「读书人的事，算不得手段。可手段不认你算不算。」"),
          menu("那一页|还回去，连誊抄的实情一并说清>+favor:npcv_036:30;incvar:favor_npcv_036:30;+karma:10;+exp:170;flag:j2b_juanzi_done;;烧了它，就当没有过这一页>+karma:-10;+favor:npcv_234:-20;incvar:favor_npcv_234:-20;+exp:140;flag:j2b_juanzi_done")
        ]
      }
    ]
    dirty61 = True

# =====================================================================
# 指路：6 个 room action 钩子
# =====================================================================
HINTS = [
  ("jn_market_south", "问和放的借据", "问和放经手的借据", ["问借据", "借据"],
   "和放把借据捆得整整齐齐。「欠账的名单我不外借。要翻，自己带上茶来。」",
   "hk_npcv_065_siqiliang"),
  ("jn_bookshop", "翻词本", "翻架上的词本", ["翻词本", "词本"],
   "架角那册词本抄得工整。翻开头一页，写的全是城里欠钱的旧事。",
   "hk_npcv_009_shuoshu"),
  ("jn_wine_house", "问那坛酒", "向店小二打听那坛陈酿", ["问酒", "那坛酒"],
   "店小二擦着碗：「陈酿一年只开两坛。上一坛叫人双倍价钱抬走了，买主连名字都没留。」",
   "hk_npcv_074_qian"),
  ("jn_yamen_wt", "翻夜里的帖子", "翻刑房夜里的帖子簿", ["翻帖子", "帖子簿"],
   "刑房的帖子簿翻开着。昨夜那页折了角，折痕新得像刚折上去的。",
   "hk_npcv_186_zuihua"),
  ("gaibang_po_miao", "看佛座底下", "看破庙佛座底下压的东西", ["看佛座", "佛座"],
   "佛座底下压着几件旧物。拨开草席一角，纸的边角露了出来。",
   "hk_npcv_095_qi"),
  ("jn_school", "问旧年学籍", "向夫子问旧年的学籍", ["问学籍", "旧学籍"],
   "夫子的书架上，旧年学籍那几册的书脊磨得发白。最旧那册上落了灰，灰上有指痕。",
   "hk_npcv_036_juanzi"),
]
for rid, cmd, label, kws, text, qid in HINTS:
    room = d50['rooms'][rid]
    acts = room.setdefault('actions', [])
    if not any(a.get('cmd') == cmd for a in acts):
        acts.append({
            "cmd": cmd, "label": label, "keywords": kws,
            "desc": label,
            "cond": {"quest": qid},
            "effects": [{"type": "narrate", "raw": text}]
        })
        dirty50 = True

# ---------------- 落盘 ----------------
if dirty61:
    write(P61, d61); print('OK: 61_sidequests（段2 六案 S3 改造 + 说书案 giver 归位）')
else:
    print('OK（已落，跳过）: 61_sidequests')
if dirty50:
    write(P50, d50); print('OK: 50_map（段2 六案指路 room action）')
else:
    print('OK（已落，跳过）: 50_map')

# ---------------- 断言 ----------------
v61, v50 = read(P61), read(P50)
CASES = ['hk_npcv_065_siqiliang', 'hk_npcv_009_shuoshu', 'hk_npcv_074_qian',
         'hk_npcv_186_zuihua', 'hk_npcv_095_qi', 'hk_npcv_036_juanzi']
S0 = {  # s0 verbatim 快照（narrate/say 首句 + menu 首选 flag）
 'hk_npcv_065_siqiliang': ['元若：「我这四十七两，不催他。我就等他自己开口。」', 'hk_npcv_065_siqiliang_paid'],
 'hk_npcv_009_shuoshu': ['醒木一响，唱词里三个名字串成一句，堂下有人红了脸。', 'hk_npcv_009_shuoshu_buy'],
 'hk_npcv_074_qian': ['「强秋那晚的酒，是我换的。他在门外站了半宿，我在屋里没敢开门。」', 'hk_npcv_074_qian_clear'],
 'hk_npcv_186_zuihua': ['「我这条命是捡的。捡来的命，多活一天赚一天。」', 'hk_npcv_186_zuihua_hold'],
 'hk_npcv_095_qi': ['她把那半张契举到日头底下。年份那两个字的墨色，比别处新。', 'hk_npcv_095_qi_hide'],
 'hk_npcv_036_juanzi': ['「读书人的事，算不得手段。」', 'hk_npcv_036_juanzi_back'],
}
MAIN_FLAGS = ('snow_evidence', 'know_zhenyi', 'jiuye_done', 'act1_', 'act2_', 'act3_')
for qid in CASES:
    q = v61['quests'][qid]
    tag = q['name']
    assert len(q['stages']) in (4, 5), tag + ' stage 数不在 4-5'
    s0 = q['stages'][0]
    assert s0.get('next') == 1, tag + ' s0 next 没接上'
    raws = [e.get('raw') for e in s0['effects'] if e.get('type') in ('narrate', 'say')]
    assert S0[qid][0] in raws, tag + ' s0 原文被动'
    menus = [e for s in q['stages'] for e in s.get('effects', []) if e.get('type') == 'menu']
    assert len(menus) >= 2, tag + ' 菜单数不足'
    m0 = menus[0]['raw']
    assert 'flag:' + S0[qid][1] in m0, tag + ' s0 原菜单首选 flag 被动'
    assert q['stages'][-1].get('lock', {}).get('flag') == 'jiuye_done', tag + ' 收束卷界锁没落'
    assert q['stages'][-1].get('next') == 99, tag + ' 收束 next 不是 99'
    rw = json.dumps(q.get('rewards'), ensure_ascii=False)
    assert q.get('rewards') and 'quest' not in rw and not any(f in rw for f in MAIN_FLAGS), tag + ' rewards 被动/并主线'
    for s in q['stages']:
        for t in s.get('targets', []):
            assert t['key'] in v50['rooms'], tag + ' 目标房悬空: ' + t['key']
    blob = json.dumps(q['stages'][1:], ensure_ascii=False)
    assert '——' not in blob, tag + ' 破折号混入'
# 说书案归位断言
qs = v61['quests']['hk_npcv_009_shuoshu']
assert qs['npc'] == 'hk_storyteller' and qs['giver'] == 'hk_storyteller', '说书案没归位'
assert 'hk_npcv_009_shuoshu' not in (v61['npcs']['npcv_009'].get('quests') or []), 'npcv_009 还挂着说书案'
assert all(a.get('cmd') != '听说书' for a in (v61['npcs']['npcv_009'].get('actions') or [])), 'npcv_009 还留着听说书动作'
st = v61['npcs'].get('hk_storyteller') or {}
assert 'hk_npcv_009_shuoshu' in (st.get('quests') or []), '柳三弦没挂说书案'
hit_act = [a for a in (st.get('actions') or []) if a.get('cmd') == '问柳三弦']
assert len(hit_act) == 1, '柳三弦接案动作没落（问柳三弦）'
assert '说书' not in ''.join(hit_act[0].get('keywords') or []), 'keywords 撞房动作 listen 说书'
# require
assert v61['quests']['hk_npcv_009_shuoshu']['require'] == {"and": [{"questDone": "hk_npcv_009_baizi"}, {"flag": "jiuye_done"}]}
assert v61['quests']['hk_npcv_074_qian']['require'] == {"and": [{"questDone": "hk_npcv_074_yajian"}, {"flag": "jiuye_done"}]}
for rid, cmd, qid in HINTS and [(h[0], h[1], h[5]) for h in HINTS]:
    acts = v50['rooms'][rid]['actions']
    hit = [a for a in acts if a.get('cmd') == cmd]
    assert len(hit) == 1 and hit[0]['cond'] == {"quest": qid}, rid + ' 指路动作没落'
assert any(a.get('cmd') == 'list 茶博士' for a in v50['rooms']['jn_teahouse']['actions'])
assert any(a.get('cmd') == 'ask 夫子 about 学问' for a in v50['rooms']['jn_school']['actions'])
assert any(a.get('cmd') == 'list 书斋' for a in v50['rooms']['jn_bookshop']['actions'])
assert any(a.get('cmd') == '翻米行流水' for a in v50['rooms']['jn_market_west']['actions']), '段1 指路被动'
print('断言全过：段2 六案 / s0 verbatim / 收束卷界锁 / require / rewards 不并主线 / 说书案 giver 归位三件 / 指路 6 处 / 段1 指路未被动 / 无破折号')
