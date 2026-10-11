/* ============================================================
 * gen-content-extra.js — 势力武学 / 江湖散学 / 天材地果 / 效果物 / 奇遇 / 拍卖池
 *   产出 game/data/75_content_extra.json
 *
 * 依据 design/44 R5（势力武学与非常多江湖武学）+ design/40 §6.3（拍卖行）+ §7（内容扩充）
 * ⚠️ 只写 75_content_extra.json 一个文件。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '75_content_extra.json');

const skills = {}, items = {}, books = {}, encounters = [];

/* ---------------- 一、势力武学（R5-1/R5-2：朝廷≈一流势力，各家有自己的武学） ---------------- */
const FACTION_SKILLS = [
  { id: 'con_xuanjia_fist', name: '玄甲拳', type: '拳', cat: '外功', g: 1, base: 'basic_fist', motif: 'buffAtk', desc: '禁军操练的拳法，一招一式都照尺子量出来的。' },
  { id: 'con_tianzi_sword', name: '天子剑', type: '剑', cat: '外功', g: 1, base: 'basic_sword', motif: 'ignoreDef', desc: '御前侍卫才准学的剑。剑鞘上缠的是明黄绦子。' },
  { id: 'con_jinyi_neigong', name: '锦衣内功', type: '内功', cat: '内功', g: 1, base: 'basic_force', desc: '锦衣卫的吐纳法，练的是耐得住刑、熬得住夜。' },
  { id: 'con_zhenfu_guard', name: '镇抚刀盾', type: '招架', cat: '外功', g: 4, base: 'basic_parry', desc: '北镇抚司的护身架子，先护住自己再谈拿人。' },
  { id: 'dongchang_soaring', name: '东厂提纵', type: '轻功', cat: '外功', g: 4, base: 'basic_dodge', desc: '翻墙进院不出声，是番子吃饭的本事。' },
  { id: 'dongchang_soul', name: '摄魂爪', type: '拳', cat: '旁门', g: 2, base: 'basic_fist', motif: 'confuse', desc: '抓的不是人，是人的胆。被抓住的多半自己就招了。' },
  { id: 'biao_escort_blade', name: '保镖刀法', type: '刀', cat: '外功', g: 5, base: 'basic_blade', motif: 'parryUp', desc: '镖行的看家刀。不图伤敌，只求货在人在。' },
  { id: 'biao_horse_fist', name: '走马拳', type: '拳', cat: '外功', g: 8, base: 'basic_fist', desc: '押车时在马背上使得的拳，稳字当先。' },
  { id: 'bang_wharf_staff', name: '码头棍', type: '棍', cat: '外功', g: 8, base: 'basic_staff', desc: '挑担的扁担也能使。帮里人打群架全靠它。' },
  { id: 'bang_river_force', name: '踏浪功', type: '内功', cat: '内功', g: 6, base: 'basic_force', desc: '水上讨生活的人练的，气沉得住，人就不沉。' },
  { id: 'salt_iron_palm', name: '盐铁掌', type: '拳', cat: '旁门', g: 3, base: 'basic_fist', motif: 'armorPen', desc: '盐帮的东西，掌心常年沾着盐，打人身上火辣辣地疼。' },
  { id: 'merchant_sleeve', name: '袖里乾坤', type: '暗器', cat: '旁门', g: 4, base: 'basic_throw', motif: 'poison', desc: '商会上不了台面的手段。袖子里的东西，看的人都没了。' },
];
for (const s of FACTION_SKILLS) {
  const ml = { 1: 900, 2: 850, 3: 800, 4: 750, 5: 700, 6: 650, 8: 550 }[s.g] || 500;
  const isHp = s.type === '内功';
  const isWp = ['剑', '刀', '棍', '拳', '暗器', '鞭'].indexOf(s.type) >= 0;
  const ef = s.motif === 'ignoreDef' ? [{ type: 'ignoreDef' }]
    : s.motif === 'buffAtk' ? [{ type: 'buff', name: '蓄力', turns: 3, mods: { atk: 45 } }]
      : s.motif === 'confuse' ? [{ type: 'confuse', chance: 0.3, turns: 2 }]
        : s.motif === 'parryUp' ? [{ type: 'buff', name: '铁壁', turns: 3, mods: { parry: 30, def: 20 } }]
          : s.motif === 'armorPen' ? [{ type: 'buff', name: '摧坚', turns: 3, mods: { armorPen: 0.2 } }]
            : s.motif === 'poison' ? [{ type: 'dot', name: '毒', turns: 4, value: 36 }] : [];
  skills[s.id] = {
    id: s.id, name: s.name, type: s.type, category: s.cat, grade: s.g,
    maxLevel: ml, difficulty: Math.round((0.7 + (9 - s.g) * 0.14) * 100) / 100,
    trainCost: 40 + (9 - s.g) * 60,
    damageMult: isWp ? Math.round((1.05 + (9 - s.g) * 0.15) * 100) / 100 : 0,
    accuracy: isWp ? 88 + (9 - s.g) : 0, mpCost: isWp ? 4 + (9 - s.g) * 4 : 0,
    ...(isHp ? { mpBonus: 50 + (9 - s.g) * 70, bonus: { maxMp: 300, maxHp: 200 } } : {}),
    effects: ef, base: s.base, faction: true,
    desc: s.desc,
  };
}

/* ---------------- 二、江湖散学（含真正「无基础武学」的散手，R2 的单独激活池就是给它们用的） ---------------- */
const STANDALONE = [
  { id: 'sa_drunk_fist', name: '醉八仙', type: '拳', g: 4, desc: '脚下打晃，招式却半点不乱。真醉的人使不出来，装醉的人也使不出来。' },
  { id: 'sa_qimen_escape', name: '奇门遁甲', type: '拳', g: 2, desc: '不是打人的功夫，是怎么让人打不着你。阵图一半在纸上，一半在人身上。' },
  { id: 'sa_turtle_breath', name: '龟息功', type: '内功', g: 3, desc: '一躺能躺三天，气息细得像没了。装死的、避祸的，都靠这门功夫。' },
  { id: 'sa_face_change', name: '易容术', type: '拳', g: 5, desc: '换张脸比换件衣裳费事些。见过的脸多了，就什么脸都能捏。' },
  { id: 'sa_bone_shrink', name: '缩骨功', type: '轻功', g: 4, desc: '锁骨一收，人矮半尺。钻窗、脱铐、藏进箱子都使得。' },
  { id: 'sa_drug_resist', name: '辟毒诀', type: '内功', g: 4, desc: '江湖上凡是要命的饭局，都得先有点这个底子。' },
];
for (const s of STANDALONE) {
  const ml = { 2: 850, 3: 800, 4: 750, 5: 700 }[s.g];
  const isHp = s.type === '内功';
  const isWp = ['剑', '刀', '棍', '拳', '鞭', '暗器'].indexOf(s.type) >= 0;
  skills[s.id] = {
    id: s.id, name: s.name, type: s.type, category: '旁门', grade: s.g,
    maxLevel: ml, difficulty: Math.round((0.7 + (9 - s.g) * 0.14) * 100) / 100,
    trainCost: 40 + (9 - s.g) * 60,
    damageMult: isWp ? Math.round((1.05 + (9 - s.g) * 0.15) * 100) / 100 : 0,
    accuracy: isWp ? 88 + (9 - s.g) : 0, mpCost: isWp ? 4 + (9 - s.g) * 4 : 0,
    ...(isHp ? { mpBonus: 50 + (9 - s.g) * 70, bonus: { maxMp: 300, maxHp: 200 } } : {}),
    effects: s.id === 'sa_drunk_fist' ? [{ type: 'cond', if: { chance: 0.35 }, then: [{ type: 'extraHit', value: 1 }] }]
      : s.id === 'sa_qimen_escape' ? [{ type: 'buff', name: '遁形', turns: 3, mods: { dodge: 60 } }]
        : s.id === 'sa_bone_shrink' ? [{ type: 'buff', name: '缩骨', turns: 3, mods: { dodge: 45, speed: 25 } }]
          : s.id === 'sa_drug_resist' ? [{ type: 'buff', name: '辟毒', turns: 9999, mods: { def: 15 } }] : [],
    standalone: true,
    desc: s.desc,
  };
}
/* 江湖武学（有根基，遍地都是） */
const COMMON = [
  { id: 'cn_wind_step', name: '疾风步', type: '轻功', g: 6, base: 'basic_dodge', desc: '跑得快不算本事，跑得久才算。' },
  { id: 'cn_iron_shirt', name: '金钟罩', type: '招架', g: 5, base: 'basic_parry', desc: '硬桥硬马地挨。练到家的能让人砍两刀不破皮。' },
  { id: 'cn_hidden_blade', name: '袖刀', type: '刀', g: 7, base: 'basic_blade', desc: '刀藏袖里，出手就到了眼前。' },
  { id: 'cn_long_fist', name: '太祖长拳', type: '拳', g: 8, base: 'basic_fist', desc: '庙会上打把式卖艺的都会。架子简单，脉络却正。' },
  { id: 'cn_bone_needle', name: '骨针', type: '暗器', g: 6, base: 'basic_throw', desc: '鱼骨也能当暗器。海边的人使这个最顺手。' },
  { id: 'cn_breath_art', name: '小周天', type: '内功', g: 7, base: 'basic_force', desc: '寻常人家也传的吐纳法，管用，不出奇。' },
  { id: 'cn_staff_sweep', name: '横扫千军', type: '棍', g: 5, base: 'basic_staff', desc: '棍法里最横的一式，一招扫开半圈人。' },
  { id: 'cn_whip_bind', name: '缠丝鞭', type: '鞭', g: 6, base: 'basic_whip', desc: '鞭子是软的，缠上就往回拖。' },
];
for (const s of COMMON) {
  const ml = { 5: 700, 6: 650, 7: 600, 8: 550 }[s.g] || 500;
  const isHp = s.type === '内功';
  skills[s.id] = {
    id: s.id, name: s.name, type: s.type, category: '外功', grade: s.g,
    maxLevel: ml, difficulty: Math.round((0.7 + (9 - s.g) * 0.14) * 100) / 100,
    trainCost: 40 + (9 - s.g) * 60,
    damageMult: isHp ? 0 : Math.round((1.05 + (9 - s.g) * 0.15) * 100) / 100,
    accuracy: 88 + (9 - s.g), mpCost: isHp ? 0 : 4 + (9 - s.g) * 4,
    ...(isHp ? { mpBonus: 50 + (9 - s.g) * 70, bonus: { maxMp: 250, maxHp: 150 } } : {}),
    ...(s.type === '招架' ? { bonus: { parry: 60 }, damageMult: 0, accuracy: 0, mpCost: 0 } : {}),
    ...(s.type === '轻功' ? { bonus: { dodge: 70, speed: 20 }, damageMult: 0, accuracy: 0, mpCost: 0 } : {}),
    effects: s.id === 'cn_staff_sweep' ? [{ type: 'aoe' }]
      : s.id === 'cn_whip_bind' ? [{ type: 'slow', value: 30, turns: 3 }]
        : s.id === 'cn_bone_needle' ? [{ type: 'dot', name: '骨刺', turns: 3, value: 30 }] : [],
    base: s.base,
    desc: s.desc,
  };
}

/* ---------------- 三、天材地果（R5-4 藏宝阁 / 奇遇 / 拍卖） ---------------- */
const TREASURES = [
  { id: 't_herb_1000', name: '千年雪参', attr: ['资质', 6], value: 9000, q: 'epic', desc: '雪线以上才长。挖出来的人多半没回来。' },
  { id: 't_lingzhi_purple', name: '紫府灵芝', attr: ['悟性', 6], value: 9000, q: 'epic', desc: '灵芝上的纹路像云，看久了人会发怔。' },
  { id: 't_dragon_grass', name: '龙涎草', attr: ['根骨', 6], value: 8000, q: 'epic', desc: '长在崖缝里，风一过就有一股腥甜味。' },
  { id: 't_ice_marrow', name: '玄冰髓', attr: ['定力', 5], value: 7000, q: 'rare', desc: '握在手里，半条胳膊是麻的。' },
  { id: 't_fire_sand', name: '赤炎砂', attr: ['力量', 5], value: 7000, q: 'rare', desc: '沙是红的，倒在掌心烫得跳脚。' },
  { id: 't_wash_marrow', name: '洗髓花', attr: ['资质', 4], value: 6000, q: 'rare', desc: '花瓣碰一下就落。听说是拿来洗筋伐髓的。' },
  { id: 't_soul_herb', name: '九叶还魂草', attr: ['根骨', 4], value: 12000, q: 'epic', desc: '九片叶子，缺一片就没用了。' },
  { id: 't_jade_fruit', name: '玉髓果', attr: ['身法', 5], value: 6500, q: 'rare', desc: '果肉像玉，咬下去是凉的。' },
  { id: 't_star_dew', name: '星辰露', attr: ['福缘', 5], value: 6000, q: 'rare', desc: '只在无月的夜里凝在叶尖上。' },
  { id: 't_iron_root', name: '铁骨藤', attr: ['根骨', 5], value: 5500, q: 'rare', desc: '藤条硬得像铁，煮水喝能壮骨。' },
  { id: 't_cloud_tea', name: '云雾茶', attr: ['定力', 3], value: 1800, q: 'fine', desc: '山寺里待客的茶，喝下去心就静了。' },
  { id: 't_wolf_fang', name: '狼牙丹', attr: ['力量', 3], value: 2200, q: 'fine', desc: '用头狼的牙磨成的粉，药性烈。' },
  { id: 't_moon_flower', name: '月见花', attr: ['悟性', 3], value: 2400, q: 'fine', desc: '夜里才开，天亮就合上。' },
  { id: 't_deep_ginseng', name: '老山参', attr: ['资质', 3], value: 2600, q: 'fine', desc: '药铺里能卖个好价，也可能被人半路截走。' },
  { id: 't_bone_powder', name: '续骨散', attr: ['根骨', 2], value: 1200, q: 'common', desc: '跌打郎中案头常备的东西。' },
];
for (const t of TREASURES) {
  items[t.id] = {
    id: t.id, name: t.name, type: 'treasure', category: '天材地果', quality: t.q,
    desc: t.desc, value: t.value, stackable: true, stackMax: 9,
    use: [{ type: '+attr', args: t.attr }],
  };
}

/* ---------------- 四、特殊效果物品 ---------------- */
const CONSUMABLES = [
  { id: 'c_mihun_xiang', name: '迷魂香', buff: { name: '迷香', turns: 2, mods: { dodge: -40, parry: -30 } }, value: 900, desc: '点着了往门缝里吹。屋里的人会自己把话说出来。' },
  { id: 'c_bixue_zhen', name: '闭穴针', buff: { name: '闭穴', turns: 2, mods: { speed: -50, atk: -30 } }, value: 1400, desc: '扎进穴道，手上就使不出劲。解针的手法各家不同。' },
  { id: 'c_lihua_zhen', name: '暴雨梨花针', buff: { name: '疾发', turns: 3, mods: { atk: 40, speed: 30 } }, value: 2600, desc: '一个铁筒里装着二十七根针。开筒之后，就没有回头路。' },
  { id: 'c_jiedu_dan', name: '解毒丹', cure: true, value: 300, desc: '药铺里买得到，管不管用看配药的人。' },
  { id: 'c_xionghuang', name: '雄黄酒', cure: true, value: 200, desc: '端午喝剩下的。灌下去，肚子里那点东西就不闹了。' },
  { id: 'c_jinzhong_fu', name: '金钟符', buff: { name: '金钟', turns: 20, mods: { def: 45 } }, value: 500, desc: '画符的人说这符顶得住三刀。信不信由你。' },
  { id: 'c_dali_wan', name: '大力丸', buff: { name: '神力', turns: 20, mods: { atk: 35 } }, value: 450, desc: '药丸是黑的，嚼起来一股松香味。' },
  { id: 'c_huoxue_san', name: '活血散', heal: 120, value: 260, desc: '走镖的行囊里总有一包。' },
  { id: 'c_huiqi_dan', name: '回气丹', mp: 120, value: 300, desc: '打完一场，咽一颗，胸口那处壅塞就开了。' },
  { id: 'c_qingxin_cha', name: '清心茶', buff: { name: '清明', turns: 10, mods: { critRate: 0.08 } }, value: 380, desc: '苦得厉害，喝完眼睛反而亮了。' },
  { id: 'c_tiebu_shan', name: '铁布衫药酒', buff: { name: '硬功', turns: 15, mods: { def: 30, parry: 20 } }, value: 420, desc: '擦在身上火辣辣的，管一阵子。' },
  { id: 'c_yanzhi_fen', name: '胭脂粉', buff: { name: '易容', turns: 30, mods: { dodge: 25 } }, value: 350, desc: '抹上脸就换个人。市井里卖得比药还快。' },
  { id: 'c_meng_han_yao', name: '蒙汗药', buff: { name: '手脚发软', turns: 3, mods: { atk: -35, speed: -35 } }, value: 600, desc: '下在酒里最灵。江湖上吃过这个亏的人不少。' },
  { id: 'c_yanshi_dan', name: '燃石丹', buff: { name: '焚身', turns: 4, mods: { atk: 60, def: -20 } }, value: 1600, desc: '吞下去浑身发烫。伤人，也伤自己。' },
  { id: 'c_yunxing_fu', name: '轻身符', buff: { name: '轻身', turns: 20, mods: { dodge: 40, speed: 30 } }, value: 520, desc: '贴上之后，走路像是踩在棉花上。' },
  { id: 'c_jingxin_fu', name: '静心符', buff: { name: '静心', turns: 20, mods: { critRate: 0.1, parry: 25 } }, value: 560, desc: '庙里求的，图个心安。' },
  { id: 'c_dujian', name: '毒箭', buff: { name: '中毒', turns: 3, mods: { def: -30 } }, value: 240, desc: '箭头是黑的。拔出来一看，伤口周围也黑了。' },
  { id: 'c_xianglian', name: '安魂香', buff: { name: '安魂', turns: 10, mods: { maxMp: 80 } }, value: 480, desc: '睡前点一炉，第二天起身轻快些。' },
  { id: 'c_buqi_gao', name: '补气膏', heal: 200, mp: 80, value: 700, desc: '一小罐黑膏，闻着像熬糊了的糖。' },
  { id: 'c_zhenli_fu', name: '真力符', buff: { name: '真力', turns: 12, mods: { atk: 45, critRate: 0.05 } }, value: 1200, desc: '符上的字一笔到底，画完的人要歇半天。' },
];
for (const c of CONSUMABLES) {
  const use = [];
  if (c.buff) use.push({ type: '+buff', args: [c.buff] });
  if (c.heal) use.push({ type: '+hp', args: [c.heal] });
  if (c.mp) use.push({ type: '+mp', args: [c.mp] });
  if (c.cure) use.push({ type: 'custom', fn: 'cure', args: [] });
  items[c.id] = {
    id: c.id, name: c.name, type: 'consumable', category: '药物', quality: 'fine',
    desc: c.desc, value: c.value, stackable: true, stackMax: 9, use,
  };
}
/* 门派武学书（74 里生成的书已在 74；这里补几本江湖绝学书，供拍卖/奇遇） */
for (const [bid, sid, nm] of [
  ['book_sa_drunk', 'sa_drunk_fist', '《醉八仙拳谱》'],
  ['book_sa_qimen', 'sa_qimen_escape', '《奇门遁甲残卷》'],
  ['book_cn_iron', 'cn_iron_shirt', '《金钟罩要诀》'],
  ['book_sa_face', 'sa_face_change', '《易容术》'],
]) {
  books[bid] = {
    id: bid, name: nm, type: 'book', teach: sid,
    desc: '一本手抄的册子，边角已经磨圆了。',
    cost: 500, timeCost: 260, value: 3600,
    require: { skill: 'basic_force', '>=': 60 },
  };
}

/* ---------------- 五、奇遇（「寻访」指令触发，只在荒僻处） ---------------- */
const wildRooms = ['wild'];
const ENC = [
  ['洞窟拳经', ['book_cn_long_fist'], '岩壁上的刻痕被苔藓盖住了大半，你用手掌抹了抹，看出是一路拳架子。', 0.10],
  ['高人授艺', ['book_sa_drunk'], '树底下躺着个醉汉，睁眼看你，忽然翻身起来打了一趟拳，打完倒头又睡。', 0.07],
  ['古墓机关', ['c_jinzhong_fu', 'c_yunxing_fu'], '石阶下陷了一寸，露出个锈住的铜环。掰开来看，里头是两道符。', 0.09],
  ['江湖恩怨', ['c_lihua_zhen'], '林子里有人压着嗓子吵。你没出声，他们走的时候落下了个铁筒。', 0.08],
  ['市井机缘', ['c_dali_wan', 'c_huoxue_san'], '路边的货郎车翻了，他一边捡一边骂，看见你，塞了两样东西过来。', 0.12],
  ['天象异变', ['t_deep_ginseng'], '天色忽然暗了一瞬，再亮起来时，石缝里的东西好像变了位置。', 0.06],
  ['弃尸遗物', ['c_tiebu_shan', 'c_dujian'], '路边倒着个人，身上没伤，手里还攥着东西。', 0.08],
  ['野寺残卷', ['book_sa_qimen'], '破庙的梁上塞着个布包，你够下来一看，是半本阵图。', 0.05],
  ['老树洞藏', ['t_cloud_tea', 't_bone_powder'], '老树的洞里有东西，是前人藏的，还是松鼠拖进去的，说不清。', 0.11],
  ['崖畔奇花', ['t_moon_flower'], '崖边上开着一朵，风越大，香气越往你这边飘。', 0.09],
  ['溪底沉物', ['c_meng_han_yao'], '水底的石头缝里有东西亮了一下。你脱了鞋下去摸，摸出个小瓶。', 0.10],
  ['商队遗货', ['c_mihun_xiang', 'c_yanzhi_fen'], '官道边的车辙印很深，走远了还有一股香粉味。地上落着两样。', 0.09],
];
ENC.forEach(([name, loot, text, chance], i) => {
  encounters.push({
    id: 'enc_' + i,
    name,
    rooms: wildRooms,
    chance,
    effects: [
      { type: 'narrate', raw: text },
      { type: 'randomitem', args: loot },
    ],
  });
});

/* ---------------- 六、拍卖行配置（design/40 §6.3） ---------------- */
const auction = {
  intervalDays: 3,
  slots: 12,
  highSlots: 2,
  minRaise: 0.05,
  feeRate: 0.08,
  listingFee: 0.02,
  consignMinValue: 500,
  /* 固定池：药材 / 兵器 / 丹药 / 特殊物 */
  pool: [
    't_deep_ginseng', 't_cloud_tea', 't_wolf_fang', 't_moon_flower', 't_bone_powder',
    'c_dali_wan', 'c_huoxue_san', 'c_jiedu_dan', 'c_jingxin_fu', 'c_yunxing_fu',
    'c_jinzhong_fu', 'c_huiqi_dan', 'c_tiebu_shan', 'c_xianglian', 'c_qingxin_cha',
  ],
  /* 高价值位按品级加权抽（品级越小越稀罕）——数值见 balance §5.2 */
  highPool: [
    { grade: 1, w: 2 }, { grade: 2, w: 4 }, { grade: 3, w: 6 }, { grade: 4, w: 8 },
    { grade: 5, w: 10 }, { grade: 6, w: 12 }, { grade: 7, w: 14 }, { grade: 8, w: 16 }, { grade: 9, w: 18 },
  ],
  highItems: ['t_herb_1000', 't_lingzhi_purple', 't_dragon_grass', 't_ice_marrow', 't_fire_sand', 't_soul_herb', 'c_lihua_zhen', 'c_yanshi_dan', 'c_zhenli_fu', 'c_bixue_zhen'],
};

fs.writeFileSync(OUT, JSON.stringify({
  skills, items, books, encounters, auction,
  /* 各大城的市集设「拍卖行」标记。用新字段而不是动 room.actions ——
     actions 是**数组、replace 语义**，往里塞一条会把原有的整段顶掉。 */
  rooms: {
    luoyang_market: { auctionHouse: true },
    changan_market: { auctionHouse: true },
    chengdu_market: { auctionHouse: true },
    xiangyang_market: { auctionHouse: true },
    jiangnan_market: { auctionHouse: true },
    gusu_town: { auctionHouse: true },
  },
}, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('势力武学', FACTION_SKILLS.length, '散手', STANDALONE.length, '江湖武学', COMMON.length);
console.log('天材地果', TREASURES.length, '效果物', CONSUMABLES.length, '书', Object.keys(books).length, '奇遇', encounters.length);
