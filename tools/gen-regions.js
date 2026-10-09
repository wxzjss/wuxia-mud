'use strict';
/* ==========================================================================
 *  gen-regions.js —— 补齐 50_map.json 的 regions 定义（步骤 1）
 *
 *  病症：房间实际用了 32 个 region tag，但 regions 只定义了 12 个。
 *        其余 20 个在 maplayout.packRegions() 里 fallback 成英文 id，
 *        玩家在地图上看到 "huashan" 而不是「华山」。
 *
 *  做法：按 design/09-map-district-allocation.md §2 的分区表补全，
 *        每条带 name / color / tier / province / desc / entry / minW / minH。
 *  幂等：已存在的键只补缺字段，不覆盖人工改过的 name/color。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');

/* tier: town 城镇 / capital 京城 / sect 门派 / mad 魔教 / wild 野外 /
 *       village 村落 / fun 娱乐 / court 官府 / secret 禁区 / realm 秘境 */
const REGIONS = {
  /* ── 江南东道 ── */
  jiangnan: {
    name: '江南', color: '#5a9a8a', tier: 'town', province: '江南东道',
    desc: '烟雨江南，繁华地。柔石板路，脂粉香里藏着刀光。',
    entry: 'jiangnan_gate', minW: 14, minH: 14,
  },
  market: {
    name: '东市', color: '#a07a3a', tier: 'town', province: '江南东道',
    desc: '百货骈阗，人如潮。绸缎、瓷器、消息，都在这里流通。',
    entry: 'jn_market_main', minW: 8, minH: 8,
  },
  qinglou: {
    name: '醉春楼', color: '#9a4a7a', tier: 'fun', province: '江南东道',
    desc: '丝竹盈耳，酒色满楼。听得见笑，看不见人心。',
    entry: 'jiangnan_brothel', minW: 6, minH: 6,
  },

  /* ── 河南道 ── */
  luoyang: {
    name: '洛阳', color: '#a05a2a', tier: 'town', province: '河南道',
    desc: '九朝古都，牡丹倾城。城中多的是旧人、旧事、旧刀。',
    entry: 'luoyang_gate', minW: 10, minH: 10,
  },

  /* ── 关中道 ── */
  changan: {
    name: '长安', color: '#8a4a4a', tier: 'capital', province: '关中道',
    desc: '天子脚下，规矩最大。街巷规整，连吵架都要低声。',
    entry: 'changan_gate', minW: 10, minH: 10,
  },

  /* ── 蜀道 ── */
  chengdu: {
    name: '成都', color: '#4a7a4a', tier: 'town', province: '蜀道',
    desc: '锦官城，市井慢。茶馆里摆龙门阵，一摆就是半天。',
    entry: 'chengdu_gate', minW: 10, minH: 10,
  },

  /* ── 荆襄道 ── */
  xiangyang: {
    name: '襄阳', color: '#5a5a8a', tier: 'town', province: '荆襄道',
    desc: '铁骑十万，甲兵天下。此地不产侠客，只产将才。',
    entry: 'xiangyang_gate', minW: 10, minH: 10,
  },

  /* ── 江南西道 ── */
  cunzhen: {
    name: '青溪村', color: '#4a8a5a', tier: 'village', province: '江南西道',
    desc: '三四十户人家，一口老井。谁家昨夜炒菜，全村都知道。',
    entry: 'cunzhen_gate', minW: 8, minH: 8,
  },
  farmland: {
    name: '田野', color: '#5a9a4a', tier: 'village', province: '江南西道',
    desc: '阡陌纵横，日出而作。田埂上走一遭，能听一整天的事。',
    entry: 'jn_farm_road', minW: 8, minH: 8,
  },
  shuyuan: {
    name: '白鹿书院', color: '#5a6a9a', tier: 'town', province: '江南西道',
    desc: '弦歌不辍，笔砚生尘。读书人的清高与穷酸，只隔一层窗纸。',
    entry: 'jn_study_1', minW: 8, minH: 8,
  },
  gusu: {
    name: '姑苏', color: '#4a8a8a', tier: 'town', province: '江南西道',
    desc: '园林深处，剑气藏锋。听得见曲子，未必听得见刀。',
    entry: 'gusu_town', minW: 8, minH: 8,
  },

  /* ── 京畿道 ── */
  yamen: {
    name: '衙门府', color: '#8a6a2a', tier: 'court', province: '京畿道',
    desc: '明镜高悬，律法无情。堂上打板子，堂下有人叫好。',
    entry: 'jn_yamen_court', minW: 8, minH: 8,
  },
  palace: {
    name: '皇城', color: '#9a2a2a', tier: 'capital', province: '京畿道',
    desc: '朱墙黄瓦，九重深处。这里的一举一动，都有人记在册上。',
    entry: 'palace_gate', minW: 8, minH: 8,
  },
  harbor: {
    name: '江口码头', color: '#3a7a9a', tier: 'town', province: '京畿道',
    desc: '千帆竞发，货通四海。船夫的消息比驿马快三天。',
    entry: 'jn_harbor', minW: 8, minH: 8,
  },

  /* ── 边塞道 ── */
  wild: {
    name: '荒野', color: '#6a6a4a', tier: 'wild', province: '边塞道',
    desc: '草长鹰飞，狼嗥四起。风里除了土腥，什么都没有。',
    entry: 'road_nan_1', minW: 12, minH: 12,
  },
  beijiang: {
    name: '北疆·雪谷', color: '#7a8a9a', tier: 'wild', province: '边塞道',
    desc: '终年不化。雪底下埋着人，也埋着刀。',
    entry: 'beijiang_xuedao', minW: 8, minH: 8,
  },
  xixia: {
    name: '西夏·盐池', color: '#8a8a5a', tier: 'wild', province: '边塞道',
    desc: '盐池如镜，咸得刺喉。煮盐的人比打仗的人多。',
    entry: 'xixia_ice', minW: 8, minH: 8,
  },

  /* ── 门派 · 五岳剑派 ── */
  huashan: {
    name: '华山', color: '#6a8a5a', tier: 'sect', province: '江湖',
    desc: '西岳峥嵘，高处不胜寒。玉女峰上的雪，从来没人扫。',
    entry: 'huashan_shanxia', minW: 8, minH: 8,
  },
  shaolin: {
    name: '少林', color: '#8a6a3a', tier: 'sect', province: '江湖',
    desc: '古刹钟声，扫尽天下尘。藏经阁里那一层，锁着最要紧的东西。',
    entry: 'shaolin_shanmen', minW: 8, minH: 8,
  },
  wudang: {
    name: '武当', color: '#5a7a8a', tier: 'sect', province: '江湖',
    desc: '玄天毓秀，太极生两仪。清修为主，却也管着山下的人间。',
    entry: 'wudang_shanmen', minW: 8, minH: 8,
  },
  emei: {
    name: '峨眉', color: '#5a8a6a', tier: 'sect', province: '江湖',
    desc: '白水秋风，缁衣如云。佛号压得住刀，压不住人心。',
    entry: 'emei_shanmen', minW: 8, minH: 8,
  },
  taohuadao: {
    name: '桃花岛', color: '#9a6a8a', tier: 'sect', province: '江湖',
    desc: '桃花流水，岛上无人。琴棋书画样样精，落花也伤人。',
    entry: 'taohuadao_dock', minW: 8, minH: 8,
  },
  dali: {
    name: '大理', color: '#7a6a9a', tier: 'sect', province: '江湖',
    desc: '王府朱门，段氏六脉。指法点穴不靠刀，杀人于谈笑。',
    entry: 'dali_wangfu', minW: 6, minH: 6,
  },
  miaojiang: {
    name: '苗疆', color: '#6a8a7a', tier: 'sect', province: '江湖',
    desc: '万山红雾，蛊虫满寨。客人来了，先喝三碗。',
    entry: 'miaojiang_sheng', minW: 6, minH: 6,
  },
  tangmen: {
    name: '唐门', color: '#8a7a5a', tier: 'sect', province: '江湖',
    desc: '毒雾暗器，见血封喉。门上那张笑脸，是给死人的。',
    entry: 'tangmen_gate', minW: 8, minH: 8,
  },
  gaibang: {
    name: '丐帮', color: '#7a6a4a', tier: 'sect', province: '江湖',
    desc: '天下第一大帮，规矩却最破。破庙里睡着的都是兄弟。',
    entry: 'gaibang_po_miao', minW: 6, minH: 6,
  },

  /* ── 魔教 ── */
  mojiao: {
    name: '黑木崖', color: '#4a3a5a', tier: 'mad', province: '江湖',
    desc: '日头照不到的地方。练的武功不分正邪，人命也不分贵贱。',
    entry: 'mojiao_shanmen', minW: 6, minH: 6,
  },
  gumu: {
    name: '谷魔窟', color: '#5a3a4a', tier: 'mad', province: '江湖',
    desc: '谷底终年不见光。魔教的旧账，都埋在这道谷里。',
    entry: 'gumu_mu', minW: 6, minH: 6,
  },

  /* ── 散点 / 秘境 / 禁区 ── */
  xiyu: {
    name: '西域', color: '#9a8a5a', tier: 'wild', province: '西域',
    desc: '大漠孤烟，佛国在西。商队带来香料，也带来刀。',
    entry: 'xiyu_oasis', minW: 8, minH: 8,
  },
  haitan: {
    name: '梅海滩', color: '#3a8a7a', tier: 'wild', province: '海外',
    desc: '潮起潮落，滩上全是贝。退潮时能走很远，别走太远。',
    entry: 'haitan_dock', minW: 6, minH: 6,
  },
  xiake: {
    name: '侠客岛', color: '#4a7a5a', tier: 'realm', province: '海外',
    desc: '岛上有山，山上有洞，洞里有的是前辈留下的东西。',
    entry: 'xiake_neike', minW: 6, minH: 6,
  },
  jinguo: {
    name: '锦国旧陵', color: '#7a5a5a', tier: 'realm', province: '北疆',
    desc: '前朝皇陵，机关未破。进去的人多，出来的人少。',
    entry: 'jinguo_ruin_d', minW: 6, minH: 6,
  },
  many: {
    name: '蛮荒', color: '#4a5a4a', tier: 'realm', province: '南疆',
    desc: '连地图都没画全的地方。传说是真的，只是没人回来。',
    entry: 'road_many_1', minW: 6, minH: 6,
  },
  secret: {
    name: '地下黑市', color: '#3a3a3a', tier: 'secret', province: '江湖',
    desc: '不见天日的地方。什么都能买，什么都能卖，包括人。',
    entry: 'secret_black_market', minW: 6, minH: 6,
  },
};

/* --- 执行 --- */
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const rooms = map.rooms || {};
const used = new Set();
for (const id in rooms) used.add(rooms[id].region || '?');

const before = Object.keys(map.regions || {}).length;
const added = [];
const filled = [];

map.regions = map.regions || {};
for (const key in REGIONS) {
  const spec = REGIONS[key];
  const cur = map.regions[key];
  if (!cur) {
    map.regions[key] = Object.assign({ id: key }, spec);
    added.push(key);
  } else {
    // 已存在：只补缺失字段，不覆盖人工改过的值
    const miss = [];
    for (const f in spec) {
      if (cur[f] === undefined) { cur[f] = spec[f]; miss.push(f); }
    }
    if (cur.id === undefined) cur.id = key;
    if (miss.length) filled.push(key + '(' + miss.join(',') + ')');
  }
}

/* 房间用到但既没定义也没在表里 → 报告（不静默） */
const missing = [...used].filter(r => !map.regions[r]);
const unused = Object.keys(map.regions).filter(r => !used.has(r));

fs.writeFileSync(MAP, JSON.stringify(map, null, 1), 'utf8');

console.log('regions: %d → %d', before, Object.keys(map.regions).length);
console.log('新增 %d 个: %s', added.length, added.join(' '));
if (filled.length) console.log('补字段 %d 个: %s', filled.length, filled.join(' '));
console.log('房间实际使用的 region: %d 个', used.size);
console.log(missing.length ? '❌ 仍未定义: ' + missing.join(' ') : '✅ 全部 region 均已定义');
console.log(unused.length ? '⚠️  定义了但没房间用: ' + unused.join(' ') : '✅ 无空定义');
