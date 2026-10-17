# -*- coding: utf-8 -*-
"""act1 P1 样板房两间：road_jiangnan_1（老槐树茶摊）+ cunzhen_gate（青溪村口）。
desc 按 design/74 成稿重写；不动现有 actions（P3 串接时再升 T-A 状态机）。"""
import json, shutil, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'game', 'data', '50_map.json')
BAK = os.path.join(BASE, 'game', 'data', '50_map_bak_pre_act1p1.json')

DESC = {
    'road_jiangnan_1':
        '土路让牛车碾出两道沟，沟底存着昨夜的雨水，结了一层薄冰，踩上去先响后塌。'
        '老槐树的根把路面顶起一块，过路的绕着走，绕出来的那道比路面低半寸，磨得发白。'
        '树荫下一个茶摊，一领芦席四根竹竿撑着，西边那根断过，接了一截，缠布条的接头旧得看不出本色。'
        '黄泥灶膛里剩着昨夜的炭，凉透了，落着一层白灰。案上一把缺嘴的壶，壶底的烟炱厚得能拿指甲刮下灰来。'
        '灶边一口水缸，半缸水，缸身一道旧裂纹，裂纹上抹过灰，灰鼓出来一道棱。',
    'cunzhen_gate':
        '村子十七户人家，房子散在朝南的坡上，化雪的地方露出一片一片黑土。'
        '村口那口井冬天冻上了，井台的冰是浑的，中间让绳子勒出一道沟，深得能塞进一根手指。'
        '石牌坊上的「青溪」二字让风磨得只剩个轮廓，坊柱根上拴马的绳眼还新。'
        '往西出村是大路，往北进村道，村道上人脚印多，出村的车辙少。',
}

if not os.path.exists(BAK):
    shutil.copy2(P, BAK)
d = json.load(open(P, encoding='utf-8'))
for rid, txt in DESC.items():
    assert d['rooms'][rid].get('desc') != txt
    print(rid, '旧 desc', len(d['rooms'][rid].get('desc', '')), '字 ->', len(txt), '字')
    d['rooms'][rid]['desc'] = txt
from _canon_write import write_canon; write_canon(P, d)
print('样板房两间已落（备份 50_map_bak_pre_act1p1.json）')
