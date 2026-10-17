#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_sect_entry_lines.py —— 114-① 29 家入门戏差异化
----------------------------------------------------------------
现状：29 个 `*_gate` 的「拜入门下」共用「山门里走出一个人，上下打量了你两眼。」
改法：**只改第一条 narrate**，joinSect 与门槛一个字节不动。
口径：按门派生计物象分型——剑派看手/握剑，刀枪拳看肩/茧，帮派看鞋/水性，
      镖局看行囊/脚程，道佛看站相/礼数，邪派看来意，商帮看行头。
纪律：29 句互不相同；≤40 字；无破折号/对偶/偏好词；幂等（第二次无改动）。
"""
import json, io, os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

LINES = {
  # ── 剑派：看手 / 握剑 / 眼与步 ──
  'taishan':   '松树底下站着守门弟子，手按剑鞘。「剑提得上肩么？提不上先空手上来。」',
  'hengshan':  '门里有人膝上横着琴，剑搁在脚边。「先听一段。听不出杀意的，剑白练。」',
  'hengshanN': '女弟子把剑横在膝上，抬眼看你。「握剑的手别抖。抖了先伤自己。」',
  'qingcheng': '雾里传来剑鞘碰石的轻响。「青城看步。步子浮的人，剑也浮。」',
  'kongtong':  '道装老者手里转着剑穗。「崆峒七伤，先看你眼稳不稳。」',
  'kunlun':    '风沙里那人把剑裹在布里。「昆仑的剑不长眼，人得长眼。」',
  'diancang':  '守门弟子弹出一枚石子，打落枝上一片叶。「点苍看两样：眼快，气沉。」',
  'wuliang':   '山门后有剑声，一下一下。「听得出哪一剑收了力么？」',
  # ── 刀枪拳掌：看肩 / 臂力 / 茧 ──
  'jindao':    '门里挂着长短不齐一排刀。「挑一把。扛得动就进。」',
  'wuhu':      '五个汉子各站一边，刀都不出鞘。「进来。看你能站哪一边。」',
  'kuaidao':   '门口有人试刀，一道白线劈过木桩。「看清楚了，再提学字。」',
  'baisheng':  '门口的人先看你的肩。「肩没开，刀抡不圆。先站三天桩。」',
  'tieqiang':  '七杆枪插在门边，杆杆有旧痕。「挑一杆，端平了走十步。」',
  'tiezhang':  '门口那只石锁上有一道捏出来的印。「掌门看手，我看你走路。」',
  'shenquan':  '院里有人打拳，拳风带起一层土。「站远点，别溅着。看完再说。」',
  'luohan':    '院里一排木桩，桩上都是拳印。「先打三拳。我看力道。」',
  'wuyun':     '老门房搓着核桃，手背一道旧疤。「温家做皮货，也用毒。传男不传女。」',
  'dafeng':    '门房抬头看了看天，又看你。「风大。进来躲一躲，也算个缘分。」',
  # ── 帮派：看鞋 / 风尘 / 水性 ──
  'huanghe':   '帮众蹲在跳板上啃馍，抬了抬下巴。「上过船没有？我看你的鞋。」',
  'taihu':     '岸上盘着船缆，帮众在补网。「会水么？不会水在这儿活不长。」',
  'poyang':    '湖风把旗子吹得直响。「裤脚还是干的。走一趟湖再来。」',
  'qingzhu':   '门边一丛竹，帮众在削竹签。「手上有茧么？削签子要这个。」',
  'jujing':    '一堵人墙似的汉子俯身看你。「鞋底磨穿过几双？说实话。」',
  'jinlong':   '门房正给门槛上油。「踩门槛的人不招待。绕一步再进。」',
  # ── 镖局：看行囊 / 脚程 ──
  'feihu':     '镖师往车上捆箱子，抬眼。「会赶车么？不会就先跟着走一趟。」',
  'zhenyuan':  '镖旗卷着靠在墙边，镖师在捆绳。「夜里赶过路么？怕不怕黑？」',
  # ── 邪派 / 山野：看来意 ──
  'baituo':    '门里那人裹着厚毡，先闻了闻风。「山上的规矩：不问来路，只问胆子。」',
  'hehuan':    '帘子后有人笑了一声。「进来可以。先说说你为什么来。」',
  'funiu':     '一条老牛卧在门口，人从牛背后出来。「它不叫，就说明你能进。」',
}

d = read = None
with io.open(os.path.join(DATA, '73_sects_place.json'), 'r', encoding='utf-8-sig') as f:
    d = json.load(f)

changed = 0
for rid, room in d.get('rooms', {}).items():
    if not rid.endswith('_gate'):
        continue
    sect = rid[:-5]
    if sect not in LINES:
        continue
    act = next((a for a in (room.get('actions') or []) if (a.get('cmd') or '').startswith('拜师')), None)
    if not act or not act.get('effects'):
        continue
    first = act['effects'][0]
    if first.get('type') != 'narrate':
        continue
    if first.get('raw') != LINES[sect]:
        first['raw'] = LINES[sect]
        changed += 1

if changed:
    write_canon(os.path.join(DATA, '73_sects_place.json'), d)
print('改写入门戏：%d 句' % changed)

# ---------------- 断言 ----------------
with io.open(os.path.join(DATA, '73_sects_place.json'), 'r', encoding='utf-8-sig') as f:
    v = json.load(f)
seen = {}
for rid, room in v['rooms'].items():
    if not rid.endswith('_gate'):
        continue
    sect = rid[:-5]
    if sect not in LINES:
        continue
    act = next(a for a in room['actions'] if (a.get('cmd') or '').startswith('拜师'))
    raw = act['effects'][0]['raw']
    assert raw == LINES[sect], f'{rid} 文案未落'
    assert any(e.get('type') == 'joinSect' for e in act['effects']), f'{rid} joinSect 丢了'
    assert len(raw) <= 40, f'{rid} 超 40 字（{len(raw)}）'
    assert '——' not in raw, f'{rid} 破折号'
    assert not re.search(r'不是[^，]{1,14}，(?:而是|是)', raw), f'{rid} 对偶'
    for w in ('最后', '落地', '死死', '猛地', '稳稳'):
        assert w not in raw, f'{rid} 偏好词 {w}'
    assert raw not in seen, f'{rid} 与 {seen.get(raw)} 重复'
    seen[raw] = rid
print('断言全过：%d 句互不相同 / ≤40 字 / joinSect 未动 / 无破折号对偶偏好词' % len(seen))
