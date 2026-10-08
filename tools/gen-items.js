/* ============================================================
 * gen-items.js — 给物品补「品质 / 喜爱标签 / 扩展物品」
 *
 * 1. 给现有物品打 quality（英文 id）+ tags（喜爱类型）
 * 2. 新增社交/生态所需物品：
 *    - 名画 / 瓷器 / 书籍 / 玉器 / 美酒 / 好茶 / 首饰 / 香料 / 乐器 / 胭脂
 *    - 容器（打水用）/ 利器（切割尸体用）
 *    - 生肉 / 兽皮 / 农作物 / 种子
 *    - 饭菜（酒楼成品）
 * 3. 幂等：已有 quality/tags 的不动；新增物品按 id 判重
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ITEM_FILE = path.join(ROOT, 'game', 'data', '20_items.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261008);
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));

const doc = JSON.parse(fs.readFileSync(ITEM_FILE, 'utf8'));
const items = doc.items;

/* ---------- 1. 名称关键词 → tags / quality ---------- */
const NAME_RULES = [
  { re: /画|舆图|图卷|山水|仕女图/, tags: ['painting', 'art'] },
  { re: /瓷|瓶|碗|盏|盂|壶|瓯/, tags: ['porcelain'] },
  { re: /书|册|卷|经|诀|谱|帖/, tags: ['book'] },
  { re: /玉|珀|珠|翠/, tags: ['jade'] },
  { re: /酒|酿|醇|春$/, tags: ['wine'] },
  { re: /茶/, tags: ['tea'] },
  { re: /钗|镯|耳|环|戒|簪|佩/, tags: ['jewelry'] },
  { re: /香|檀|沉/, tags: ['incense'] },
  { re: /剑|刀|枪|棍|鞭|匕|弩|戈|矛|镖/, tags: ['weapon'] },
  { re: /参|芝|莲|药|草|丹/, tags: ['herb', 'medicine'] },
  { re: /馍|饼|饭|面|粥|肉|鱼|果|糕|糖|羹/, tags: ['food'] },
  { re: /琴|箫|笛|筝|琵|琶|胡/, tags: ['music'] },
  { re: /风车|泥人|哨|鸢|风筝|陀螺/, tags: ['toy'] },
  { re: /胭脂|脂粉|粉盒|口脂/, tags: ['makeup'] },
  { re: /绳|索|铲|锄|斧|镰|刀$/, tags: ['tool'] },
];

function qualityById(id) {
  const n = (items[id] && items[id].name) || '';
  const v = (items[id] && items[id].value) || 10;
  /* 明确的名贵物件 */
  if (/玉玺|尚方|御|龙|凤|贡/.test(n)) return 'legend';
  if (/古|名|金|银|貂|锦|碧|夜明|玳瑁/.test(n)) {
    return v >= 1500 ? 'epic' : (v >= 400 ? 'rare' : 'fine');
  }
  if (v < 50) return 'worn';
  if (v < 200) return 'common';
  if (v < 800) return 'fine';
  if (v < 2500) return 'rare';
  if (v < 8000) return 'epic';
  return 'legend';
}

let tagged = 0, qualitySet = 0;
for (const id of Object.keys(items)) {
  const it = items[id];
  if (!it.tags || !it.tags.length) {
    const tags = new Set(it.tags || []);
    for (const r of NAME_RULES) if (r.re.test(it.name || '')) r.tags.forEach(t => tags.add(t));
    if (tags.size) { it.tags = [...tags]; tagged++; }
  }
  if (!it.quality) { it.quality = qualityById(id); qualitySet++; }
}

/* ---------- 2. 新增物品 ---------- */
const NEW = {
  /* --- 社交赠礼：名画 --- */
  painting_landscape: { name: '山水长卷', type: 'misc', value: 900, tags: ['painting', 'art'], quality: 'rare', desc: '一幅绢本山水，笔意苍润，落款已模糊不清。' },
  painting_bird: { name: '花鸟小品', type: 'misc', value: 320, tags: ['painting', 'art'], quality: 'fine', desc: '绢上绘着一只栖枝的雀儿，工笔极细。' },
  painting_court: { name: '宫廷仕女图', type: 'misc', value: 2600, tags: ['painting', 'art'], quality: 'epic', desc: '内府流出之物，绢色犹新，画的是一位云鬓凤钗的女子。' },
  scroll_famous: { name: '米氏云山卷', type: 'misc', value: 8200, tags: ['painting', 'art'], quality: 'legend', desc: '前朝大家真迹，墨色如烟雨拢山，捧在手里都觉得沉。' },

  /* --- 社交赠礼：瓷器 --- */
  porcelain_bowl: { name: '青花小碗', type: 'misc', value: 120, tags: ['porcelain'], quality: 'common', desc: '胎薄釉润，碗心画着缠枝莲。' },
  porcelain_vase: { name: '汝窑梅瓶', type: 'misc', value: 2200, tags: ['porcelain'], quality: 'epic', desc: '雨过天青色，叩之如磬，是窑口里的极品。' },
  celadon_jar: { name: '龙泉青瓷罐', type: 'misc', value: 640, tags: ['porcelain'], quality: 'fine', desc: '釉色肥润如一汪深潭，罐口描着一圈莲瓣。' },
  porcelain_teaset: { name: '成化斗彩茶具', type: 'misc', value: 3600, tags: ['porcelain', 'tea'], quality: 'epic', desc: '一壶四盏，五彩夺目，据说宫里也不过如此。' },

  /* --- 社交赠礼：书籍 --- */
  book_poem: { name: '诗集残卷', type: 'book', value: 90, tags: ['book'], quality: 'common', desc: '缺了头的旧诗集，纸页发黄，字却写得极好。' },
  book_classic: { name: '经史子集', type: 'book', value: 380, tags: ['book'], quality: 'fine', desc: '一函四册，翻开来墨香扑鼻。' },
  book_strategy: { name: '兵法孤本', type: 'book', value: 1800, tags: ['book'], quality: 'rare', desc: '批注密密麻麻，像是被人翻烂了。' },
  book_rare: { name: '宋版古籍', type: 'book', value: 5200, tags: ['book'], quality: 'epic', desc: '纸如蝉翼，字若星斗，藏书家见了要眼红。' },

  /* --- 社交赠礼：玉器 --- */
  jade_pendant: { name: '羊脂玉佩', type: 'misc', value: 1300, tags: ['jade', 'jewelry'], quality: 'rare', attr: { 定力: 1 }, desc: '温润如脂，贴在掌心一会儿就暖了。' },
  jade_talisman: { name: '辟邪玉符', type: 'misc', value: 420, tags: ['jade'], quality: 'fine', desc: '正面刻着一道云篆，据说能挡一次灾。' },
  jade_ruyi: { name: '白玉如意', type: 'misc', value: 4800, tags: ['jade', 'art'], quality: 'epic', desc: '一整块和阗玉雕成，如意云头饱满圆润。' },

  /* --- 社交赠礼：美酒 --- */
  wine_jar: { name: '土烧酒', type: 'food', value: 18, tags: ['wine', 'food'], quality: 'worn', stackable: true, stackMax: 10, healFood: 8, use: { food: 8, water: 2 }, desc: '粗陶罐装的土酒，冲鼻，但够劲。' },
  wine_bamboo: { name: '竹叶青', type: 'food', value: 150, tags: ['wine', 'food'], quality: 'fine', stackable: true, stackMax: 10, healFood: 12, use: { food: 12, water: 4 }, desc: '酒色碧绿，入口微苦，回甘却长。' },
  wine_song: { name: '女儿红', type: 'food', value: 680, tags: ['wine', 'food'], quality: 'rare', stackable: true, stackMax: 5, healFood: 18, use: { food: 18, water: 6 }, desc: '窖藏十八年的花雕，开坛香满一屋。' },
  wine_imperial: { name: '宫中御酒', type: 'food', value: 3000, tags: ['wine', 'food'], quality: 'epic', stackable: true, stackMax: 3, healFood: 30, use: { food: 30, water: 10, mp: 40 }, desc: '琥珀色的酒液，杯壁上挂着一层蜜。' },

  /* --- 社交赠礼：好茶 --- */
  tea_longjing: { name: '雨前龙井', type: 'food', value: 240, tags: ['tea', 'food'], quality: 'fine', stackable: true, stackMax: 10, healWater: 14, use: { water: 14 }, desc: '一旗一枪，泡开来满盏春色。' },
  tea_puer: { name: '陈年普洱', type: 'food', value: 520, tags: ['tea', 'food'], quality: 'rare', stackable: true, stackMax: 10, healWater: 20, healFood: 6, use: { water: 20, food: 6 }, desc: '茶饼压得紧实，掰开来一股陈香。' },

  /* --- 社交赠礼：首饰 --- */
  silver_hairpin: { name: '银步摇', type: 'misc', value: 260, tags: ['jewelry'], quality: 'fine', desc: '走起路来细碎的银铃轻响，很惹眼。' },
  gold_bangle: { name: '赤金镯子', type: 'misc', value: 1400, tags: ['jewelry'], quality: 'rare', desc: '实心足金，沉甸甸地压手。' },
  pearl_earring: { name: '南珠耳坠', type: 'misc', value: 3400, tags: ['jewelry'], quality: 'epic', desc: '两颗珠子一般大小，在光下泛着粉。' },

  /* --- 社交赠礼：香料 / 乐器 / 胭脂 / 玩物 --- */
  incense_agarwood: { name: '沉香一块', type: 'misc', value: 760, tags: ['incense'], quality: 'fine', desc: '指甲盖大小，遇火便有一缕清远的烟。' },
  sachet_silk: { name: '苏绣香囊', type: 'misc', value: 130, tags: ['incense', 'jewelry'], quality: 'common', desc: '绣着一对并蒂莲，里头装了苏合香。' },
  guqin: { name: '焦尾古琴', type: 'misc', value: 2800, tags: ['music', 'art'], quality: 'epic', desc: '琴身有一道火痕，七弦却清越异常。' },
  jade_flute: { name: '白玉箫', type: 'misc', value: 900, tags: ['music'], quality: 'rare', desc: '通体无瑕，吹起来声音像隔着水。' },
  pipa: { name: '螺钿琵琶', type: 'misc', value: 1150, tags: ['music'], quality: 'rare', desc: '背板嵌着贝壳花纹，弦一拨便如珠落玉盘。' },
  rouge_box: { name: '胭脂盒', type: 'misc', value: 80, tags: ['makeup'], quality: 'common', desc: '小小一只银盒，胭脂的颜色很正。' },
  face_powder: { name: '玉簪粉', type: 'misc', value: 160, tags: ['makeup'], quality: 'fine', desc: '粉质细腻，敷在脸上像凝了层薄霜。' },
  clay_figure: { name: '泥人张', type: 'misc', value: 25, tags: ['toy'], quality: 'worn', desc: '捏的是个扛着大刀的关公，眉眼居然有几分神气。' },
  wood_whistle: { name: '木头哨子', type: 'misc', value: 8, tags: ['toy'], quality: 'worn', desc: '随便削的，能吹出两个音。' },
  kite_swallow: { name: '燕子风筝', type: 'misc', value: 45, tags: ['toy'], quality: 'worn', desc: '竹骨糊纸，尾巴上还系了两条红飘带。' },

  /* --- 容器 / 利器（打水、切割用） --- */
  water_gourd: { name: '水葫芦', type: 'container', value: 30, tags: ['container'], quality: 'worn', container: true, capacity: 3, desc: '晒干的葫芦，装水不漏，江湖人身上常见。' },
  clay_jar: { name: '陶罐', type: 'container', value: 45, tags: ['container'], quality: 'worn', container: true, capacity: 6, desc: '粗陶烧的，能装不少水，就是重。' },
  leather_waterskin: { name: '皮水囊', type: 'container', value: 120, tags: ['container'], quality: 'common', container: true, capacity: 8, desc: '牛皮缝的水囊，骑马赶路最合用。' },
  jade_pot: { name: '玉净瓶', type: 'container', value: 2600, tags: ['container', 'jade'], quality: 'epic', container: true, capacity: 20, desc: '瓶身莹白，装的水似乎都比别处清甜。' },

  hunting_knife: { name: '剥皮刀', type: 'weapon', slot: '武器', weaponType: '刀', value: 60, tags: ['tool', 'weapon'], quality: 'common', damage: 12, sharp: true, desc: '刀身短而弯，专门用来剥皮剔骨。' },
  butcher_knife: { name: '剔骨尖刀', type: 'weapon', slot: '武器', weaponType: '刀', value: 90, tags: ['tool', 'weapon'], quality: 'common', damage: 15, sharp: true, desc: '屠户用的家什，锋利得能剃下薄如纸的肉片。' },
  fine_sword: { name: '精钢长剑', type: 'weapon', slot: '武器', weaponType: '剑', value: 420, tags: ['weapon'], quality: 'fine', damage: 42, sharp: true, desc: '剑身如一泓秋水，弹一下有龙吟。' },
  steel_blade: { name: '雁翎刀', type: 'weapon', slot: '武器', weaponType: '刀', value: 380, tags: ['weapon'], quality: 'fine', damage: 40, sharp: true, desc: '刀背厚实，一刀下去势大力沉。' },
  iron_spear: { name: '铁枪', type: 'weapon', slot: '武器', weaponType: '枪', value: 300, tags: ['weapon'], quality: 'common', damage: 36, sharp: true, desc: '枪杆是白蜡木的，枪头寒光凛凛。' },

  /* --- 生肉 / 兽皮 --- */
  raw_meat: { name: '生肉', type: 'food', value: 6, tags: ['food', 'raw'], quality: 'worn', stackable: true, stackMax: 20, use: { food: 5, nausea: true }, desc: '血淋淋的一块，生吃下去怕是要翻胃。' },
  raw_fish: { name: '生鱼', type: 'food', value: 5, tags: ['food', 'raw'], quality: 'worn', stackable: true, stackMax: 20, use: { food: 4, water: 6, nausea: true }, desc: '还在甩尾巴，鳞片滑腻腻的。' },
  cooked_meat: { name: '烤肉', type: 'food', value: 40, tags: ['food'], quality: 'common', stackable: true, stackMax: 10, healFood: 35, use: { food: 35, water: -3 }, desc: '外焦里嫩，油还在往下滴。' },
  cooked_fish: { name: '清蒸鱼', type: 'food', value: 55, tags: ['food'], quality: 'common', stackable: true, stackMax: 10, healFood: 30, healWater: 8, use: { food: 30, water: 8 }, desc: '葱丝姜片铺了一层，鲜得很。' },
  animal_pelt: { name: '兽皮', type: 'material', value: 60, tags: ['material'], quality: 'common', stackable: true, stackMax: 20, desc: '硝制过的皮子，可以卖给皮货商。' },
  fine_pelt: { name: '上等貂皮', type: 'material', value: 880, tags: ['material'], quality: 'rare', stackable: true, stackMax: 10, desc: '毛色油亮，摸上去像捧着一团暖云。' },

  /* --- 农作物 / 种子 --- */
  crop_rice: { name: '稻谷', type: 'material', value: 12, tags: ['crop', 'food'], quality: 'worn', stackable: true, stackMax: 50, desc: '刚割下来的稻穗，还带着露水。' },
  crop_wheat: { name: '麦子', type: 'material', value: 10, tags: ['crop', 'food'], quality: 'worn', stackable: true, stackMax: 50, desc: '颗粒饱满，晒干了就能磨面。' },
  crop_vegetable: { name: '青菜', type: 'material', value: 8, tags: ['crop', 'food'], quality: 'worn', stackable: true, stackMax: 50, healFood: 10, use: { food: 10 }, desc: '水灵灵的，还沾着泥。' },
  seed_rice: { name: '稻种', type: 'material', value: 5, tags: ['seed'], quality: 'worn', stackable: true, stackMax: 50, desc: '一小袋谷种，撒到田里就能长。' },
  seed_vegetable: { name: '菜种', type: 'material', value: 4, tags: ['seed'], quality: 'worn', stackable: true, stackMax: 50, desc: '一小包菜籽。' },

  /* --- 酒楼饭菜 --- */
  dish_braised_pork: { name: '红烧肉', type: 'food', value: 80, tags: ['food'], quality: 'common', healFood: 40, use: { food: 40, water: -4 }, desc: '肥而不腻，酱色红亮，下饭最好。' },
  dish_sweet_sour: { name: '糖醋鲤鱼', type: 'food', value: 120, tags: ['food'], quality: 'fine', healFood: 45, healWater: 10, use: { food: 45, water: 10 }, desc: '整条鱼翻成菊花状，浇上琥珀色的糖醋汁。' },
  dish_noodles: { name: '阳春面', type: 'food', value: 20, tags: ['food'], quality: 'worn', healFood: 25, healWater: 12, use: { food: 25, water: 12 }, desc: '清汤寡水，但撒了葱花，香气扑鼻。' },
  dish_dumpling: { name: '一屉水饺', type: 'food', value: 35, tags: ['food'], quality: 'common', healFood: 32, use: { food: 32 }, desc: '皮薄馅大，蘸了醋更香。' },
};

let added = 0;
for (const id of Object.keys(NEW)) {
  if (items[id]) {
    /* 已存在：只补缺失的社交字段 */
    const it = items[id];
    const def = NEW[id];
    if (!it.tags && def.tags) it.tags = def.tags;
    if (!it.quality && def.quality) it.quality = def.quality;
    continue;
  }
  items[id] = Object.assign({ id }, NEW[id]);
  added++;
}

fs.writeFileSync(ITEM_FILE, JSON.stringify(doc, null, 2), 'utf8');

const ids = Object.keys(items);
console.log('物品总数：', ids.length);
console.log('新打标签：', tagged, ' 新打品质：', qualitySet, ' 新增物品：', added);
const withTags = ids.filter(i => (items[i].tags || []).length);
console.log('带 tags 物品：', withTags.length);
const byQuality = {};
for (const i of ids) byQuality[items[i].quality] = (byQuality[items[i].quality] || 0) + 1;
console.log('品质分布：', JSON.stringify(byQuality));
const byTag = {};
for (const i of ids) for (const t of (items[i].tags || [])) byTag[t] = (byTag[t] || 0) + 1;
console.log('标签分布：', JSON.stringify(byTag, null, 1));
