/* ============================================================
 * gen-sect-arts.js — 各门派 / 势力的「可在 NPC 交互界面使用的功法」
 *   → game/data/85_sect_arts.json
 *
 * 主人要求：**有正面、有反面、有特殊，各不相同，不要模板化**。
 * 所以这里不是「一个效果套 43 个门派名」，而是逐家按它的看家本事挑**不同的效果类型**：
 *   疗人（heal_npc）· 赠授内力（mp_gift）· 安抚（soothe）· 震慑（awe）
 *   讨要（gift）· 问秘（interrogate）· 引路（lure）· 削功（curse）· 留印（mark）
 *
 * 前提照旧：**须先运起本门功法**（needSkills 指向自家的功法），
 * 且（除「正面」那几种）只对实力弱于自己的人使得出 —— 这条由 arts.js 统一管。
 *
 * ⚠️ 只写 85 一个文件。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '85_sect_arts.json');

/* 每条：门派 id / 功法名 / 需运起的本门功法后缀 / 效果 / 内力 / 基础成功率 / 文案 */
const LIST = [
  /* ---------- 一流 7 家 ---------- */
  { sect: 'shaolin', name: '醍醐灌顶', cat: '内功', need: 'force_1', effect: 'mp_gift', mp: 30, chance: 0.85, favor: 22, val: 6,
    desc: '以自家真气替人疏通经脉。少林僧替香客做这一手，分文不取。',
    ok: '你掌心贴上{name}的后心，一股暖流过去。他长出一口气，脸色红润了些。',
    fail: '{name}身子一偏，避开了你的手：「不必。」' },
  { sect: 'wudang', name: '太极化劲', cat: '内功', need: 'force_1', effect: 'soothe', mp: 24, chance: 0.8,
    desc: '不与人争，只把人身上那点戾气化掉。武当道长劝架，多半用这个。',
    ok: '你手腕轻轻一转，{name}身上那股紧绷的劲儿散了，呼吸也平了。',
    fail: '{name}把胳膊一缩，没让你搭上手。' },
  { sect: 'huashan', name: '剑意示人', cat: '剑', need: 'atk_1', effect: 'awe', mp: 26, chance: 0.6, turns: 180,
    desc: '不必出剑。剑意在，对面就知道深浅了。',
    ok: '你按剑而立，没有出手。{name}的额角见汗，退了半步。',
    fail: '{name}盯着你的手看了半晌，忽然笑了：「虚的。」' },
  { sect: 'emei', name: '佛光渡厄', cat: '内功', need: 'force_1', effect: 'heal_npc', mp: 28, chance: 0.85, favor: 18,
    desc: '替人包扎上药，顺手把经脉里的滞气推一推。',
    ok: '你替{name}处理了伤处。他活动了下手脚，说轻快多了。',
    fail: '{name}把袖子一抽：「不用你管。」' },
  { sect: 'gaibang', name: '江湖规矩', cat: '旁门', need: 'qimen_1', effect: 'gift', mp: 12, chance: 0.62,
    desc: '丐帮讨东西从不硬来。他讲的是规矩，你要是不给，往后在同道里就不好看。',
    ok: '你拱了拱手，把话说得漂亮。{name}叹了口气，摸出些东西来。',
    fail: '{name}两手一摊：「今天真没有。」' },
  { sect: 'mojiao', name: '摄魂夺魄', cat: '魔功', need: 'qimen_1', effect: 'interrogate', mp: 44, chance: 0.42,
    desc: '教中不传之秘。被问了的人事后只记得自己说过话，记不得说了什么。',
    ok: '你盯着{name}的眼睛说了几句。他眼神发直，把不该说的也说了。',
    fail: '{name}猛地咬了下舌尖，回过神来，把你瞪了一眼。' },
  { sect: 'dali', name: '一阳指封穴', cat: '拳', need: 'atk_1', effect: 'awe', mp: 30, chance: 0.55, turns: 120,
    desc: '指力点到即止。封的不是穴道，是「动手」这个念头。',
    ok: '你抬手虚点。{name}浑身一僵——他知道那一指要是实的，自己现在已经躺下了。',
    fail: '{name}侧身让开，脸色却更沉了。' },

  /* ---------- 二流（含新 8 家）---------- */
  { sect: 'tangmen', name: '无影毒', cat: '暗器', need: 'qimen_1', effect: 'poison', mp: 22, chance: 0.62, dot: 26, turns: 40,
    desc: '不是杀人的毒，是「你还欠着我一笔」的意思。解药在唐门手上。',
    ok: '你替{name}添了茶。他喝了。往后几天他会一直觉得身上不得劲。',
    fail: '{name}端着杯子没动：「我不渴。」' },
  { sect: 'miaojiang', name: '蛊惑', cat: '暗器', need: 'qimen_1', effect: 'lure', mp: 36, chance: 0.45, minutes: 240,
    desc: '小东西钻进人身上，那人就会觉得「跟着他去」是件很自然的事。',
    ok: '你袖口一抖。{name}忽然站住，回头看了看你，像是想起了什么，跟了上来。',
    fail: '{name}烦躁地揉了揉胳膊，把袖子放了下来。' },
  { sect: 'taohua', name: '迷魂曲', cat: '音波', need: 'qimen_1', effect: 'lure', mp: 34, chance: 0.5, minutes: 180,
    desc: '一支笛曲。听的人自己会走过来，不觉得是被谁叫的。',
    ok: '你吹了两句就把笛子收了。{name}怔怔地朝你这边走了几步才停住。',
    fail: '{name}皱起眉：「别吹了，吵。」' },
  { sect: 'gumu', name: '寒玉定神', cat: '内功', need: 'force_1', effect: 'soothe', mp: 26, chance: 0.7,
    desc: '寒玉床上练出的功夫，按在人心口上，能把人的火气冻住。',
    ok: '你手背贴上{name}的额头。他打了个激灵，随即安静下来。',
    fail: '{name}一把打开你的手：「凉。」' },
  { sect: 'xingxiu', name: '化功', cat: '魔功', need: 'qimen_1', effect: 'curse', mp: 40, chance: 0.45, val: 8,
    desc: '星宿派的看家本领。不伤人，化人的内力 —— 化掉就回不来了。',
    ok: '你在他腕上搭了一下。{name}只觉得那口气提不上来了，却说不出哪里不对。',
    fail: '{name}把手抽回去，狐疑地看着你。' },
  { sect: 'xuedao', name: '血刀威压', cat: '刀', need: 'atk_1', effect: 'awe', mp: 24, chance: 0.65, turns: 240,
    desc: '血刀门的法子。不用讲道理，刀往那儿一插，道理就来了。',
    ok: '你把刀往地上一顿。{name}的声音立刻低了下去。',
    fail: '{name}嗤了一声：「吓唬谁呢。」' },

  { sect: 'taishan', name: '泰山压顶', cat: '拳', need: 'atk_1', effect: 'awe', mp: 28, chance: 0.58, turns: 150,
    desc: '泰山派的架子起手就是一座山。人站不住，心先矮半截。',
    ok: '你往那儿一立，{name}不自觉地退了半步。',
    fail: '{name}梗着脖子没退。' },
  { sect: 'hengshan', name: '琴音问心', cat: '音波', need: 'qimen_1', effect: 'interrogate', mp: 32, chance: 0.5,
    desc: '衡山派用琴问话。曲子跟人走，人心里的事会自己浮上来。',
    ok: '你拨了半阕就停手。{name}愣愣地看着琴，把心里那桩事说了。',
    fail: '{name}按住琴弦：「别弹了。」' },
  { sect: 'hengshanN', name: '佛前许愿', cat: '内功', need: 'force_1', effect: 'heal_npc', mp: 30, chance: 0.8, favor: 20,
    desc: '庵堂里的尼姑替人上药，从不问这个伤是怎么来的。',
    ok: '你替{name}敷了药，又念了句佛。他低头道了声谢。',
    fail: '{name}摇头：「我这点伤不碍事。」' },
  { sect: 'qingcheng', name: '摧心暗劲', cat: '拳', need: 'qimen_1', effect: 'poison', mp: 28, chance: 0.55, dot: 34, turns: 36,
    desc: '青城的手法伤在内里，外头一点痕迹也没有。',
    ok: '你替{name}拍了拍背上的灰。他当时没觉出什么。',
    fail: '{name}让开了半步。' },
  { sect: 'kongtong', name: '七伤示警', cat: '拳', need: 'atk_1', effect: 'awe', mp: 36, chance: 0.6, turns: 200,
    desc: '先伤己，再伤人。崆峒派当众打一套七伤拳，比说什么都管用。',
    ok: '你对着石桩打了一拳，石桩裂了，你的手也渗了血。{name}脸色变了。',
    fail: '{name}看着你手上的血，什么也没说。' },
  { sect: 'kunlun', name: '两仪剑势', cat: '剑', need: 'atk_1', effect: 'awe', mp: 30, chance: 0.6, turns: 160,
    desc: '一柄剑使两个人的招式，看的人只顾着数剑，忘了自己也要动手。',
    ok: '你剑势一分，{name}的眼睛跟着两边看，脖子都僵了。',
    fail: '{name}眯起眼：「花架子。」' },
  { sect: 'diancang', name: '渔樵点破', cat: '剑', need: 'qimen_1', effect: 'interrogate', mp: 30, chance: 0.48,
    desc: '点苍派不逼供，只把你话里的破绽点出来。人一慌，自己就说了。',
    ok: '你说了一句话，把{name}噎住了。他急着辩解，越辩越多。',
    fail: '{name}把嘴闭得死紧。' },
  { sect: 'tiezhang', name: '铁掌拍肩', cat: '拳', need: 'atk_1', effect: 'gift', mp: 20, chance: 0.6,
    desc: '铁掌帮讲交情的方式：一巴掌拍在肩上，那人就把东西拿出来了。',
    ok: '你一巴掌拍在{name}肩上，他龇着牙笑了，从怀里掏了东西出来。',
    fail: '{name}的肩膀硬得像块石头，没理你。' },

  /* ---------- 三流 20 家（市井手段，朴素）---------- */
  { sect: 'jindao', name: '亮刀子', cat: '刀', need: 'atk_1', effect: 'gift', mp: 14, chance: 0.55, desc: '把刀在桌上磕一下，比说什么都直接。',
    ok: '你把刀往桌上一磕。{name}把身上值钱的摸了出来。', fail: '{name}瞅了你一眼，把口袋翻出来给你看——空的。' },
  { sect: 'wuhu', name: '断门刀势', cat: '刀', need: 'atk_1', effect: 'awe', mp: 18, chance: 0.5, turns: 120, desc: '五招使完，人还在，胆子没了。',
    ok: '你刀势一收，{name}的腿肚子在抖。', fail: '{name}看得津津有味：「就这？」' },
  { sect: 'feihu', name: '趟子话', cat: '旁门', need: 'qimen_1', effect: 'gift', mp: 10, chance: 0.6, desc: '走镖的嘴皮子。江湖上的门道，说开了就是人情。',
    ok: '你说了几句镖行的行话。{name}笑了，塞了些东西给你。', fail: '{name}摆手：「你说的这套我不懂。」' },
  { sect: 'zhenyuan', name: '老镖局的面子', cat: '旁门', need: 'qimen_1', effect: 'gift', mp: 10, chance: 0.62, desc: '报上镇远镖局的名号，多少给几分薄面。',
    ok: '你报了名号。{name}点了点头，取了些东西出来。', fail: '{name}摇头：「镖局的面子在这条街上不管用。」' },
  { sect: 'shenquan', name: '老兵的规矩', cat: '拳', need: 'atk_1', effect: 'soothe', mp: 12, chance: 0.65, desc: '当过兵的人劝架：先让人把拳头放下。',
    ok: '你按住{name}的手腕，话说得很慢。他到底把拳头松开了。', fail: '{name}甩开了你的手。' },
  { sect: 'tieqiang', name: '枪杆子横过来', cat: '棍', need: 'atk_1', effect: 'awe', mp: 16, chance: 0.52, turns: 120, desc: '一杆铁枪横在门口，进来的人得先掂量掂量。',
    ok: '你把枪横在门框上。{name}在门口站住了。', fail: '{name}从枪底下钻了过去。' },
  { sect: 'kuaidao', name: '快手一刀', cat: '刀', need: 'atk_1', effect: 'awe', mp: 18, chance: 0.55, turns: 100, desc: '刀出鞘再回鞘，看的人只听见一声响。',
    ok: '你刀已在鞘中，{name}的发带断了一截。他摸着头，不说话了。', fail: '{name}低头看了看发带，笑了。' },
  { sect: 'luohan', name: '扎马步', cat: '拳', need: 'atk_1', effect: 'soothe', mp: 10, chance: 0.6, desc: '罗汉门的法子：讲不成理就一起站着，站到气消。',
    ok: '你陪{name}站了一炷香。他先开的口，语气软了。', fail: '{name}转身就走。' },
  { sect: 'wuyun', name: '皮货行的暗手', cat: '拳', need: 'qimen_1', effect: 'mark', mp: 16, chance: 0.6, desc: '五云手温家的门道：拍你一下，你身上就有股味，狗能找到你。',
    ok: '你替{name}掸了掸衣领。他道了谢——那点味道跟了他三天。', fail: '{name}自己拍了拍衣领。' },
  { sect: 'dafeng', name: '插科打诨', cat: '轻功', need: 'qimen_1', effect: 'soothe', mp: 12, chance: 0.62, desc: '大风云飞门的看家本事其实是嘴。一通闲扯，气就散了。',
    ok: '你扯了几句闲话。{name}被逗笑了，先前那点脾气没了。', fail: '{name}不吃这一套。' },
  { sect: 'huanghe', name: '摆码头', cat: '棍', need: 'atk_1', effect: 'gift', mp: 14, chance: 0.55, desc: '黄河帮的规矩：这块水面是我的，你要过，得留点东西。',
    ok: '你说了句话，{name}就懂了。他解下些东西放在地上。', fail: '{name}装傻：「什么码头？」' },
  { sect: 'taihu', name: '水上的路子', cat: '刀', need: 'qimen_1', effect: 'lure', mp: 20, chance: 0.5, minutes: 120, desc: '太湖帮拉人上船，靠的是一句「顺路」。',
    ok: '{name}想了想，觉得顺路，就跟着走了。', fail: '{name}摇头：「我不上船。」' },
  { sect: 'poyang', name: '撞船', cat: '棍', need: 'atk_1', effect: 'awe', mp: 18, chance: 0.5, turns: 120, desc: '鄱阳帮不跟你讲理，船头就横过来了。',
    ok: '你把家伙往地上一杵。{name}把话咽了回去。', fail: '{name}没退。' },
  { sect: 'qingzhu', name: '竹梆子', cat: '刀', need: 'qimen_1', effect: 'mark', mp: 12, chance: 0.6, desc: '青竹帮在货上盖个记号，全帮的人就都认得。',
    ok: '你让{name}在册子上按了个手印。往后这条街上的人都认得他。', fail: '{name}把手缩回去了。' },
  { sect: 'jujing', name: '海上的话', cat: '刀', need: 'qimen_1', effect: 'interrogate', mp: 24, chance: 0.5, desc: '巨鲸帮的人出过海。他们说的事，岸上的人没听过。',
    ok: '你讲了件海上的事。{name}听得入神，话也多了起来。', fail: '{name}不感兴趣。' },
  { sect: 'jinlong', name: '堂口的架子', cat: '拳', need: 'qimen_1', effect: 'gift', mp: 14, chance: 0.58, desc: '金龙帮堂口修得气派。人在里头坐一坐，口气就软了。',
    ok: '你把{name}让到堂口的椅子上坐下。他坐了一会儿，自己开口了。', fail: '{name}不坐。' },
  { sect: 'wuliang', name: '走个过场', cat: '剑', need: 'atk_1', effect: 'soothe', mp: 16, chance: 0.65, desc: '无量剑派东宗西宗比了几十年，比出个道理：过场走完，气也消了。',
    ok: '你陪{name}比划了几下，谁也没赢。他反而笑了。', fail: '{name}不肯下场。' },
  { sect: 'funiu', name: '按牛的法子', cat: '拳', need: 'atk_1', effect: 'awe', mp: 18, chance: 0.55, turns: 120, desc: '伏牛派按得住一头牛，自然也按得住人。',
    ok: '你搭住{name}的肩膀往下按了按。他动弹不得。', fail: '{name}一屁股坐地上了，却没服。' },
  { sect: 'baisheng', name: '百胜的招牌', cat: '刀', need: 'atk_1', effect: 'gift', mp: 12, chance: 0.55, desc: '「百胜」两个字挂出去，多少唬得住人。',
    ok: '你报了招牌。{name}犹豫了一下，还是给了。', fail: '{name}说没听说过。' },
  { sect: 'baituo', name: '袖里的蛇', cat: '拳', need: 'qimen_1', effect: 'awe', mp: 24, chance: 0.6, turns: 200, desc: '白驼山的人不用动手。袖子动一下，对面的汗就下来了。',
    ok: '你的袖子动了动。{name}的脸白了。', fail: '{name}没看见。' },

  /* ---------- 势力 6 家 ---------- */
  { sect: 'court', name: '出示腰牌', cat: '旁门', need: 'atk_1', effect: 'awe', mp: 16, chance: 0.75, turns: 300,
    desc: '一块腰牌，比十把刀好用。官家的人走到哪儿都吃这一套。',
    ok: '你把腰牌亮出来。{name}的腰立刻弯下去半寸。', fail: '{name}眯着眼看那块牌子：「假的吧。」' },
  { sect: 'dongchang', name: '番子手段', cat: '魔功', need: 'qimen_1', effect: 'interrogate', mp: 40, chance: 0.5,
    desc: '东厂问话从不用刑。他们有的是让人自己开口的法子。',
    ok: '你说了几句很轻的话。{name}把知道的全倒了出来。', fail: '{name}把嘴闭上了。' },
  { sect: 'biao', name: '保人平安', cat: '刀', need: 'atk_1', effect: 'heal_npc', mp: 22, chance: 0.8, favor: 16,
    desc: '镖行的规矩：路上遇见受伤的，先治，别问。',
    ok: '你替{name}裹了伤，还把随身的水给了他。', fail: '{name}摆手不用。' },
  { sect: 'bang', name: '帮里的交情', cat: '棍', need: 'qimen_1', effect: 'gift', mp: 12, chance: 0.6,
    desc: '帮会的人认人不认理。报上堂口，多少有几分情面。',
    ok: '你报了自己堂口的名号。{name}笑了笑，拿了东西出来。', fail: '{name}说跟你们帮没来往。' },
  { sect: 'salt', name: '盐引人情', cat: '旁门', need: 'qimen_1', effect: 'gift', mp: 14, chance: 0.62,
    desc: '盐帮手上过的是盐引。给不给货，一句话的事。',
    ok: '你提了句盐引上的事。{name}犹豫半晌，还是点了头。', fail: '{name}说这事他做不了主。' },
  { sect: 'merchant', name: '算盘珠子', cat: '旁门', need: 'qimen_1', effect: 'interrogate', mp: 20, chance: 0.6,
    desc: '商会不问你秘密，只跟你算账。账算到第三笔，人就自己说漏了。',
    ok: '你替{name}算了笔账。他为了辩驳，把底细露了出来。', fail: '{name}摆手：「不跟你算。」' },
];

/* 需运起的功法：本门派的入门功法（各家都有 {sect}_{后缀}） */
function needSkillsOf(item) {
  const base = [];
  /* 势力（朝廷/东厂/镖局…）没有 `{势力}_{后缀}` 这种门派功法，别造悬空 id */
  const SECT_ONLY = ['court', 'dongchang', 'biao', 'bang', 'salt', 'merchant'];
  if (item.need && SECT_ONLY.indexOf(item.sect) < 0) base.push(`${item.sect}_${item.need}`);
  /* 势力没有门派功法，退回通用内功/外功 */
  if (item.sect === 'court') base.push('con_xuanjia_fist', 'con_jinyi_neigong');
  if (item.sect === 'dongchang') base.push('dongchang_soul', 'xunchun_blade_art');
  if (item.sect === 'biao') base.push('biao_escort_blade');
  if (item.sect === 'bang') base.push('bang_wharf_staff', 'bang_river_force');
  if (item.sect === 'salt') base.push('salt_iron_palm');
  if (item.sect === 'merchant') base.push('merchant_sleeve');
  return Array.from(new Set(base));
}

const list = LIST.map(it => {
  const art = {
    id: 'sart_' + it.sect, name: it.name, cat: it.cat || '旁门',
    needSkills: needSkillsOf(it),
    sectOnly: (it.sect === 'court' || it.sect === 'yamen') ? undefined : undefined,
    mpCost: it.mp || 20, baseChance: it.chance || 0.6,
    effect: it.effect,
    desc: it.desc, ok: it.ok, fail: it.fail,
    /* 只有「正面」那几种不要求实力压制 —— 给药、替人疗伤，谁都能做 */
    allowStronger: ['heal_npc', 'mp_gift', 'soothe'].indexOf(it.effect) >= 0,
  };
  if (it.turns) art.seconds = it.turns * 60;
  if (it.minutes) art.minutes = it.minutes;
  if (it.val) art.val = it.val;
  if (it.dot) { art.dot = it.dot; art.turns = it.turns; }
  if (it.favor) art.favor = it.favor;
  return art;
});

/* ⚠️ 顶层键必须与 83_arts.json 的 `arts` **不同**：两者都是对象，同键会被按键合并 ——
   后加载的 85 会把 83 那份通用秘技整段顶掉。 */
fs.writeFileSync(OUT, JSON.stringify({ sectArts: { note: '各门派/势力的专属互动功法（NPC 交互界面使用）', list } }, null, 2) + '\n', 'utf8');
console.log('写入', OUT, '｜共', list.length, '门');
const byEffect = {};
for (const a of list) byEffect[a.effect] = (byEffect[a.effect] || 0) + 1;
console.log('效果分布', JSON.stringify(byEffect));
