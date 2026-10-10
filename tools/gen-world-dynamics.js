/**
 * gen-world-dynamics.js —— 把 W5/W6/W7 数据（worldEvents / factions / calendar / 世界传闻种子）
 * 安全地「追加」进 `game/data/70_world.json`（现有 rumorSeeds 一字不动）。
 *
 * 为什么用文本拼接而不是整体 JSON.stringify 重写：
 *   原文件是 **CRLF + 2 空格缩进**，且带 `"weight": 3.0` 这种**保号小数**——
 *   JSON.parse→stringify 会把 `3.0` 压成 `3`，整文件 diff 假象巨大。
 *   本工具只**插入**新键，不动既有字节。
 *
 * 幂等：已存在 worldEvents 键 → 直接退出（不写）。
 * 用法：node tools/gen-world-dynamics.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'game', 'data', '70_world.json');

/* ------------------------------------------------------------------ *
 * 一、世界传闻种子（design/27 §2.6，subject 非 player）
 * ------------------------------------------------------------------ */
const WORLD_SEEDS = {
  rs_e_world_disaster: {
    id: 'rs_e_world_disaster', kind: '天灾', polarity: 0, weight: 1.5, heat0: 70,
    tauDays: 8, ttlDays: 25, loud: true,
    texts: {
      true: '北边今年的收成，怕是完了。',
      half: '听说北边闹了灾，粮价要动。',
      false: '北边绝收了，饿殍遍野，逃难的人往南涌。',
    },
    marks: ['灾荒'],
  },
  rs_e_world_sect: {
    id: 'rs_e_world_sect', kind: '门派', polarity: 0, weight: 2.0, heat0: 65,
    tauDays: 10, ttlDays: 30, loud: true,
    texts: {
      true: '听说了吗，那几个门派又动了刀子。',
      half: '风声说两大门派近来不睦，早晚要出事。',
      false: '江湖要大乱了，几家门派已经血拼了好几场！',
    },
    marks: ['门派'],
  },
  rs_e_world_market: {
    id: 'rs_e_world_market', kind: '行情', polarity: 0, weight: 1.0, heat0: 50,
    tauDays: 6, ttlDays: 15, loud: false,
    texts: {
      true: '码头的货，这两天价不对。',
      half: '听人说集上的行情有点变。',
      false: '货价涨疯了，一日三变！',
    },
    marks: ['行情'],
  },
  rs_e_world_wanted: {
    id: 'rs_e_world_wanted', kind: '官面', polarity: -1, weight: 2.5, heat0: 75,
    tauDays: 7, ttlDays: 20, loud: true,
    texts: {
      true: '城门口贴了图，说是要拿一个人。',
      half: '听说官府在查一桩案子。',
      false: '官府发了海捕文书，方圆百里都在拿人！',
    },
    marks: ['官面'],
  },
};

/* ------------------------------------------------------------------ *
 * 二、W5 事件库（挂在 onDayTick）
 *   ⚠️ 只写能被玩家察觉的（narrate/me/say/flag/var/rep/rumor/menu）
 *   ⚠️ 禁止 combat:（跨日无战斗上下文，实测抛错 —— design/27 §1.2）
 * ------------------------------------------------------------------ */
const N = (raw) => ({ type: 'narrate', raw });
const M = (raw) => ({ type: 'me', raw });

const WORLD_EVENTS = [
  { id: 'w5_locust', cat: '天灾饥荒', name: '蝗灾',
    cond: { and: [{ season: 'summer' }, { region: 'farmland' }, { chance: 0.12 }] },
    effects: [N('天边飞来一片黄云，落到地里才知是蝗虫——它们不叫，只响。'),
      'var:grain_price=3', 'flag:famine_year', 'rumor:rs_e_world_disaster'],
    cooldownDays: 60 },

  { id: 'w5_wanted_poster', cat: '官府缉拿', name: '画影图形',
    cond: { and: [{ karma: '<=-30' }, { chance: 0.3 }] },
    effects: [N('城门口新贴了一张告示，画上的人眉眼竟有几分像你，围看的人散了又聚。'),
      'flag:wanted_poster', '-rep:朝廷:20', 'rumor:rs_e_world_wanted'],
    cooldownDays: 30 },

  { id: 'w5_wanted_amnesty', cat: '官府缉拿', name: '大赦',
    cond: { and: [{ flag: 'holiday_yuandan' }, { var: 'wanted', op: '>=', value: 1 }] },
    effects: [N('新岁大赦，衙门口贴了榜：凡未结的旧案，一笔勾销。'),
      'var:wanted=0', 'unflag:wanted_poster', '+rep:朝廷:5'] },

  { id: 'w5_foe_bribe', cat: '江湖恩怨', name: '托人递话',
    cond: { and: [{ var: 'rumor_heat_bad_max', op: '>=', value: 10 }, { chance: 0.2 }] },
    effects: [M('一个不相识的后生拦住你，递上一封没有署名的信'),
      N('信上只有一句：识相的，趁早离了这地界。'), 'flag:foe_warned'],
    cooldownDays: 15 },

  { id: 'w5_sect_clash', cat: '门派纷争', name: '两派械斗',
    cond: { and: [{ var: 'faction_rel_huashan_mojiao', op: '<', value: -40 }, { chance: 0.2 }] },
    effects: [M('山道上一伙人正打得难解难分'),
      'rumor:rs_e_world_sect',
      'menu:帮谁|帮华山>+rep:huashan:20;;帮魔教>+rep:mojiao:20;;都不帮>-rep:*:3'],
    cooldownDays: 20 },

  { id: 'w5_sect_recruit', cat: '门派纷争', name: '大开山门',
    cond: { and: [{ var: 'faction_power_huashan', op: '>=', value: 55 }, { chance: 0.15 }] },
    effects: [N('华山近来声势正盛，山门前求艺的人排了半里地。'), 'flag:sect_recruiting'],
    cooldownDays: 25 },

  { id: 'w5_storyteller', cat: '市井琐事', name: '说书人',
    cond: { and: [{ room: 'jn_teahouse' }, { chance: 0.2 }] },
    effects: [N('茶博士把长嘴壶一提，满堂安静下来，说书的清了清嗓子。'),
      'rumor:rs_e_world_market'],
    cooldownDays: 3 },

  { id: 'w5_price_swing', cat: '商路货殖', name: '货价波动',
    cond: { and: [{ region: 'harbor' }, { chance: 0.25 }] },
    effects: [N('码头上几条船刚靠岸，脚夫喊的价，比上个月高了两成。'),
      'var:price_harbor=1.2', 'rumor:rs_e_world_market'],
    cooldownDays: 10 },

  { id: 'w5_refugee', cat: '天灾饥荒', name: '流民入城',
    cond: { and: [{ flag: 'famine_year' }, { region: 'market' }, { chance: 0.3 }] },
    effects: [N('城门口涌进一群面黄肌瘦的人，扶老携幼，一言不发。'), 'flag:refugees'],
    cooldownDays: 12 },

  { id: 'w5_wedding', cat: '市井琐事', name: '迎亲',
    cond: { and: [{ region: 'jiangnan' }, { chance: 0.06 }] },
    effects: [N('街那头锣鼓响起来，一顶花轿由远及近，看热闹的人挤了半条街。')],
    cooldownDays: 8 },

  { id: 'w5_beacon', cat: '边关烽火', name: '烽火台举烟',
    cond: { and: [{ room: 'road_beijiang_1' }, { chance: 0.15 }] },
    effects: [N('西北方向升起了三道烟。头一道是黑的，第二道也是黑的，第三道隔了很久才起来。'),
      'flag:hu_raid_warn'],
    cooldownDays: 30 },

  { id: 'w5_snow_block', cat: '边关烽火', name: '雪封山',
    cond: { and: [{ season: 'winter' }, { region: 'beijiang' }, { chance: 0.2 }] },
    effects: [N('一夜大雪，山道上的车辙全被填平，前头怕是走不通了。')],
    cooldownDays: 20 },
];

/* ------------------------------------------------------------------ *
 * 三、W6 势力模板（design/27 §3.1，真 id）
 * ------------------------------------------------------------------ */
const SECT_FACTIONS = [
  ['huashan', '华山派', '门派', '正道', 'huashan', 58],
  ['shaolin', '少林派', '门派', '正道', 'shaolin', 46],
  ['wudang', '武当派', '门派', '正道', 'wudang', 46],
  ['emei', '峨眉派', '门派', '正道', 'emei', 46],
  ['gaibang', '丐帮', '门派', '中立', 'gaibang', 52],
  ['tangmen', '唐门', '门派', '中立', 'tangmen', 40],
  ['mojiao', '日月神教', '门派', '邪道', 'mojiao', 52],
  ['miaojiang', '苗疆五毒教', '门派', '邪道', 'miaojiang', 46],
  ['dali', '大理段氏', '门派', '正道', 'dali', 46],
  ['xingxiu', '星宿派', '门派', '邪道', 'xiyu', 46],
  ['gumu', '古墓派', '门派', '中立', 'gumu', 40],
  ['taohua', '桃花岛', '门派', '中立', 'taohuadao', 46],
  ['xiake', '侠客岛', '门派', '中立', 'xiake', 40],
  ['xuedao', '血刀门', '门派', '邪道', 'beijiang', 46],
];
function buildFactions() {
  const out = {};
  for (const [id, name, kind, align, region, power] of SECT_FACTIONS) {
    out[id] = { id, name, kind, align, homeRegion: region, power, treasury: 800 + power * 20, territories: [region], mood: '守成' };
  }
  out.court = { id: 'court', name: '朝廷', kind: '官府', align: '中立', homeRegion: 'yamen', power: 55, treasury: 9000,
    territories: ['yamen', 'palace', 'luoyang', 'changan', 'chengdu', 'xiangyang'], mood: '巡查' };
  out.gang = { id: 'gang', name: '漕帮', kind: '商会', align: '中立', homeRegion: 'harbor', power: 40, treasury: 5200,
    territories: ['harbor'], mood: '走货' };
  return out;
}

/* ------------------------------------------------------------------ *
 * 四、W7 节庆日历（design/27 §4.2/§4.4）
 * ------------------------------------------------------------------ */
const CALENDAR = {
  yearDays: 120, seasonDays: 30, monthDays: 30,
  festivals: [
    { day: 0, id: 'yuandan', name: '元日',
      effects: [N('城中爆竹声不断，家家户户贴了新联，见面都拱手道一声新岁。'), 'flag:holiday_yuandan'] },
    { day: 15, id: 'shangyuan', name: '上元',
      effects: [N('入夜挂起灯来，一条街都是红的；人挤人，灯也挤灯。'), 'flag:holiday_shangyuan'] },
    { day: 35, id: 'qingming', name: '清明',
      effects: [N('城外坟茔多了许多新土，纸钱的灰被风卷着，飘飘荡荡。'), 'flag:holiday_qingming'] },
    { day: 55, id: 'duanwu', name: '端午',
      effects: [N('河上龙舟鼓声震天，岸上人山人海；雄黄酒一坛坛往桌上搬。'), 'flag:holiday_duanwu', '+food:20'] },
    { day: 70, id: 'qixi', name: '七夕',
      effects: [N('桥头巷口成双成对，卖巧果的摊子前围了不少人。'), 'flag:holiday_qixi'] },
    { day: 95, id: 'zhongqiu', name: '中秋',
      effects: [N('月亮圆得晃眼，家家把桌摆到院里；就是江湖人，今夜也少动刀兵。'),
        'flag:holiday_zhongqiu', '+pot:30'] },
    { day: 110, id: 'chongyang', name: '重阳',
      effects: [N('半山都是登高赏菊的人，菊酒的气味一路飘下来。'), 'flag:holiday_chongyang', '+pot:30'] },
    { day: 118, id: 'suichu', name: '岁除',
      effects: [N('这一夜家家守岁，灯亮到天明；官府的差役也歇了班。'), 'flag:holiday_suichu'] },
  ],
  cycles: [
    { id: 'wulin_dahui', name: '武林大会', periodDays: 240, offset: 60, span: 4,
      venue: ['shaolin_daxiong', 'wudang_zixiao'],
      effects: [N('少林与武当联名下帖，邀天下同道赴会——武林大会开了。'), 'flag:cycle_wulin'] },
    { id: 'caoyun', name: '漕运开帮', periodDays: 120, offset: 50, span: 3,
      venue: ['jn_harbor'],
      effects: [N('漕帮开帮，码头上人喊马嘶，货船排出去几里地。'), 'flag:cycle_caoyun'] },
  ],
};

/* ================================================================== */
function indentBlock(objText, pad) {
  const lines = objText.split('\n');
  return lines.map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

function build() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const data = JSON.parse(raw);
  if (data.worldEvents) {
    console.log('已存在 worldEvents —— 幂等退出，未写入');
    return { wrote: false };
  }

  const CR = '\r\n';
  /* 1) 追加世界传闻种子（放进 rumorSeeds 内） */
  let seedsText = '';
  for (const k of Object.keys(WORLD_SEEDS)) {
    const body = indentBlock(JSON.stringify(WORLD_SEEDS[k], null, 2).replace(/\n/g, CR), '    ');
    seedsText += '    ' + `"${k}": ` + body + ',' + CR;
  }
  seedsText = seedsText.replace(/,\r\n$/, CR);

  /* 2) 追加顶层键 */
  const topObj = { worldEvents: { onDayTick: WORLD_EVENTS }, factions: buildFactions(), calendar: CALENDAR };
  let topText = '';
  for (const k of Object.keys(topObj)) {
    const body = indentBlock(JSON.stringify(topObj[k], null, 2).replace(/\n/g, CR), '  ');
    topText += '  ' + `"${k}": ` + body + ',' + CR;
  }
  topText = topText.replace(/,\r\n$/, CR);

  /* 3) 拼接：从 rumorSeeds 的最后一条之后插入 */
  const anchor = '"marks": ["重案", "血案"]\r\n    }\r\n  }\r\n}\r\n';
  if (!raw.endsWith(anchor)) {
    throw new Error('锚点不匹配 —— 70_world.json 尾部与预期不符，拒绝写入');
  }
  const head = raw.slice(0, raw.length - anchor.length);
  const out = head
    + '"marks": ["重案", "血案"]\r\n    },\r\n'
    + seedsText + '\r\n  },\r\n'
    + topText
    + '}\r\n';

  /* 4) 写前校验：解析得出来、且新键内容与预期语义一致 */
  const parsed = JSON.parse(out);
  for (const k of Object.keys(WORLD_SEEDS)) {
    if (!parsed.rumorSeeds[k]) throw new Error('写入校验失败：缺种子 ' + k);
  }
  if (!parsed.worldEvents || parsed.worldEvents.onDayTick.length !== WORLD_EVENTS.length) {
    throw new Error('写入校验失败：worldEvents 条数不符');
  }
  if (Object.keys(parsed.factions).length !== 16) throw new Error('写入校验失败：factions 不是 16 个');
  if (parsed.calendar.festivals.length !== 8) throw new Error('写入校验失败：festivals 不是 8 个');
  /* 既有 16 条一个不少 */
  const keep = ['rs_kill_named', 'rs_kill_civilian', 'rs_theft_caught', 'rs_resist_arrest', 'rs_save_life',
    'rs_alms', 'rs_tournament_win', 'rs_sect_join', 'rs_sect_betray', 'rs_deadbeat', 'rs_break_marriage',
    'rs_secret_out', 'rs_dungeon_clear', 'rs_drunkard', 'rs_bigspender', 'rs_jailbreak'];
  for (const k of keep) if (!parsed.rumorSeeds[k]) throw new Error('写入校验失败：既有种子丢失 ' + k);

  /* 只插入、不重排 → 前缀必须逐字节相同 */
  if (out.slice(0, head.length) !== head) {
    throw new Error('写入校验失败：前缀被改动');
  }

  fs.writeFileSync(FILE, out, 'utf8');
  console.log('已写入 70_world.json：+4 世界种子 / +%d worldEvents / +%d factions / +%d festivals',
    WORLD_EVENTS.length, Object.keys(parsed.factions).length, parsed.calendar.festivals.length);
  return { wrote: true };
}

if (require.main === module) build();
module.exports = { build, WORLD_SEEDS, WORLD_EVENTS, CALENDAR };
