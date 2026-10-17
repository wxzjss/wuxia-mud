#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/_apply_inn_goods.py —— 村口小铺货单补齐（qa 老账：desc 说「粗茶与烧饼」，货摊没有）
----------------------------------------------------------------
新增两件货并上架 `shop_village`：
  tea_coarse 粗茶 2 文（水 +8）
  flatbread  烧饼 3 文（food +25）
幂等：item 已存在则不覆盖；goods 已含则不重复加。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _canon_write import write_canon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'game', 'data')

def read(fn):
    with io.open(os.path.join(DATA, fn), 'r', encoding='utf-8-sig') as f:
        return json.load(f)

d20 = read('20_items.json')
items = d20['items']
added = 0

if 'tea_coarse' not in items:
    items['tea_coarse'] = {
        "id": "tea_coarse", "name": "粗茶", "type": "food",
        "desc": "大壶里舀出来的一碗，叶子粗，热气足。",
        "healWater": 8, "healFood": 2, "value": 2,
        "stackable": True, "stackMax": 99, "quality": "worn",
        "tags": ["tea", "food"],
    }
    added += 1
if 'flatbread' not in items:
    items['flatbread'] = {
        "id": "flatbread", "name": "烧饼", "type": "food",
        "desc": "炉壁上贴出来的，一面焦，一面软，芝麻掉了半层。",
        "healFood": 25, "value": 3,
        "stackable": True, "stackMax": 99, "quality": "worn",
    }
    added += 1
if added:
    write_canon(os.path.join(DATA, '20_items.json'), d20)
print('新增物品：%d 件' % added)

d62 = read('62_shops.json')
shop = (d62.get('shops') or {}).get('shop_village')
assert shop, 'shop_village 不存在'
goods = shop.setdefault('goods', [])
have = {g.get('item') for g in goods}
n = 0
for iid, price in (('tea_coarse', 2), ('flatbread', 3)):
    if iid not in have:
        goods.append({"item": iid, "price": price})
        n += 1
if n:
    write_canon(os.path.join(DATA, '62_shops.json'), d62)
print('上架：%d 件' % n)

# 断言
v20, v62 = read('20_items.json'), read('62_shops.json')
for iid in ('tea_coarse', 'flatbread'):
    assert iid in v20['items'], iid + ' 未新增'
shop2 = v62['shops']['shop_village']
ids = [g.get('item') for g in shop2['goods']]
assert 'tea_coarse' in ids and 'flatbread' in ids, '货摊未上架: ' + str(ids)
print('断言全过：村口小铺现有 %d 件货（含粗茶 2 文 / 烧饼 3 文）' % len(ids))
