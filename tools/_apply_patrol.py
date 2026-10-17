#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_patrol.py —— 114-③ 门派每日巡山（贡献通道）
----------------------------------------------------------------
背景：门派贡献只有「捐钱 10 文→1」「大比 60~180」两条，35 派等于没有日常正路。
本批给 35 派各加一条**每日一次**的「巡山」房动作：
  - `oncePerDay: true`（引擎 commands.js:5598 已支持，`st.gifts.last` 按日重置）
  - `cond: {"sect": "<sect>"}`（非本门不给）
  - 效果：一句本派山景 + `+contrib 本门 5`（不加经验，避免刷级）
挂房纪律：写「最后定义该房且带 actions 键」的分片。幂等：按 cmd 存在即跳过。
"""
import json, io, os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

# sect → (房, 巡山一句)
P = {
  'jindao':   ('jindao_gate',   '门前那排刀挨个看过去，刃口都还亮。'),
  'wuhu':     ('wuhu_gate',     '五条道各走了半程，道上没有生人。'),
  'kuaidao':  ('kuaidao_gate',  '木桩换了新的，旧的劈口还留着。'),
  'baisheng': ('baisheng_gate', '墙根的桩子挨个拍过去，手上有回音。'),
  'tieqiang': ('tieqiang_gate', '七杆枪挨个扶正，有一杆松了半寸。'),
  'tiezhang': ('tiezhang_gate', '门口那只石锁被挪回原位，地上留了个坑。'),
  'shenquan': ('shenquan_gate', '院里的土扫平了，脚印一层压一层。'),
  'luohan':   ('luohan_gate',   '木桩上的拳印又深了一层。'),
  'xuedao':   ('beijiang_xuedao', '雪线往后退了一段，前庭的石阶露出来半截。'),
  'mojiao':   ('mojiao_shanmen', '崖下的哨换了班，雾里看不清脸。'),
  'taishan':   ('taishan_gate',   '石阶从下到上数了一遍，第七级又松了。'),
  'hengshan':  ('hengshan_gate',  '剑坪的落叶扫过一遍，风又送回来一些。'),
  'hengshanN': ('hengshanN_gate', '后殿的灯都亮着，一盏灯芯结了花。'),
  'qingcheng': ('qingcheng_gate', '雾里沿着崖边走了一圈，栏杆都还结实。'),
  'kongtong':  ('kongtong_gate',  '演武场的兵器一杆杆扶正。'),
  'kunlun':    ('kunlun_gate',    '风口那面旗换了新的，边角压得死。'),
  'diancang':  ('diancang_gate',  '院里的石子又多了几颗，圆的不多。'),
  'wuliang':   ('wuliang_gate',   '剑架上的剑一柄柄看过，都没有手印。'),
  'hehuan':    ('hehuan_gate',    '新换的帘子在风里晃，颜色比旧的沉。'),
  'wuyun':     ('wuyun_gate',     '院里的柴码得齐，离墙都留了三寸。'),
  'dafeng':    ('dafeng_gate',    '门口的土扫过，风一过又落一层。'),
  'funiu':     ('funiu_gate',     '牛棚的草添满了，老牛没抬头。'),
  'baituo':    ('baituo_gate',    '毡子晒了一天，收的时候还带着日头味。'),
  'huanghe':   ('huanghe_gate',   '跳板上的霜刮净了，走上去不打滑。'),
  'taihu':     ('taihu_gate',     '补好的网挂在架子上，网眼都匀。'),
  'poyang':    ('poyang_gate',    '旗子收进仓里，杆子还立在原处。'),
  'qingzhu':   ('qingzhu_gate',   '新削的竹签捆成一扎，签尖都朝里。'),
  'jujing':    ('jujing_gate',    '舱里的水舀干净了，木板泛白。'),
  'jinlong':   ('jinlong_gate',   '门槛的油擦匀了，从外看是一道亮线。'),
  'feihu':     ('feihu_gate',     '镖车上的绳重新捆过，结都朝外。'),
  'zhenyuan':  ('zhenyuan_gate',  '镖旗卷好入库，旗面没有受潮。'),
  'tangmen':   ('tangmen_gate',   '药圃的篱笆补了两处，土还是新的。'),
  'gumu':      ('gumu_mu',        '墓道里的灯添了油，风进不来。'),
  'xingxiu':   ('xiyu_xingxiu',   '沙丘背风那一面走了半圈，没有脚印。'),
  'xiake':     ('xiake_neike',    '岛上的路走了一遍，石阶上没有人。'),
}

FILES = sorted(f for f in os.listdir(DATA) if f.endswith('.json'))
docs = {fn: read(fn) for fn in FILES}

def last_definer(rid):
    """优先最后一个「带 actions 键」的定义（写它才不会被更后面的覆盖）；
    若全库都没有 actions 键，就落最后一个定义该房的分片（那里新建 actions 数组不会被覆盖）。"""
    with_actions = None
    any_def = None
    for fn in FILES:
        r = (docs[fn].get('rooms') or {}).get(rid)
        if not isinstance(r, dict):
            continue
        any_def = fn
        if 'actions' in r:
            with_actions = fn
    return with_actions or any_def

added, skipped = 0, 0
for sect, (rid, line) in P.items():
    fn = last_definer(rid)
    if not fn:
        print('⚠️ 找不到房定义:', rid)
        continue
    room = docs[fn]['rooms'][rid]
    acts = room.setdefault('actions', [])
    if any(a.get('cmd') == '巡山' for a in acts):
        skipped += 1
        continue
    # 撞词检查
    mine = {'巡山', '巡视', '转一圈'}
    for a in acts:
        other = {a.get('cmd', '')} | set(a.get('keywords') or [])
        assert not (mine & {x for x in other if x}), f'{rid} 巡山撞词: {mine & other}'
    acts.append({
        "cmd": "巡山", "label": "巡山", "keywords": ["巡山", "巡视", "转一圈"],
        "desc": "在门派里走一圈",
        "cond": {"sect": sect},
        "oncePerDay": True,
        "effects": [
            {"type": "narrate", "raw": line},
            {"type": "contrib", "args": ["本门", 5]},
        ],
    })
    added += 1

if added:
    touched = {last_definer(rid) for rid, _ in P.values()}
    for fn in sorted(f for f in touched if f):
        write_canon(os.path.join(DATA, fn), docs[fn])
print(f'巡山：新增 {added} 处，已存在跳过 {skipped} 处')

# 断言
for sect, (rid, line) in P.items():
    fn = last_definer(rid)
    assert fn, rid + ' 找不到房定义'
    v = read(fn)
    a = next((x for x in (v['rooms'][rid].get('actions') or []) if x.get('cmd') == '巡山'), None)
    assert a, f'{rid} 巡山未落'
    assert a.get('oncePerDay') is True and a.get('cond') == {"sect": sect}, f'{rid} 限次/门派条件不对'
    assert any(e.get('type') == 'contrib' and e['args'] == ['本门', 5] for e in a['effects']), f'{rid} 缺 contrib'
    assert len(line) <= 40 and '——' not in line, f'{rid} 文案不合规'
print('断言全过：%d 派巡山齐（oncePerDay / cond.sect / contrib 5 / 文案 ≤40）' % len(P))
