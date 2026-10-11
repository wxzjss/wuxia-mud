/* ============================================================
 * gen-sidequests-culture.js —— 据画像写支线（#112 收尾）
 *
 * 主人原话：「增加你认为画像写得好的 npc 的根据画像来写会发生的支线剧情」。
 *
 * 挑的是**江南七才子 + 花魁 + 提学**这九位 —— 他们的画像（96_portraits_a.json）
 * 是全库写得最实的一批：每个人都有「他想要什么 / 他怕什么」，
 * 而这两样本身就是支线：一个人想要的东西，就是他请你帮的忙。
 *
 * ⚠️ 三条纪律（都是本项目踩过的坑）：
 *   ① 目标只用 `kind:'room'` —— 全库 285 个 room 目标都有推进点
 *      （engine.js:1458），而 `kill`/`var`/`flag` 类目标**没有写入源**，
 *      写上去就是永远做不完的任务（静默卡死）。
 *   ② 房间 id 必须是真实存在的（写错一个字母 = 任务指着一个不存在的地方，
 *      而且不报错）。生成时逐个校验。
 *   ③ 抉择一律走 `menu:`，两个选项都要有代价 —— 帮人不是免费的。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;
const ROOM = id => { if (!w.data.rooms[id]) throw new Error('房间不存在：' + id); return id; };

function sq(o) {
  const q = {
    id: o.id, name: o.name, type: '支线', npc: o.npc, giver: o.npc, level: o.level,
    desc: o.desc,
    stages: [{
      desc: o.stageDesc,
      targets: [{ id: 'go0', kind: 'room', key: ROOM(o.room), count: 1, var: o.id + '_go0', desc: o.stageDesc }],
      next: 99,
      effects: o.effects,
    }],
    rewards: [{ type: 'say', raw: o.outro }],
  };
  return q;
}

const Q = [];

/* ---- 唐寅：画好了，懒得送 ---- */
Q.push(sq({
  id: 'hk_tang_bohu', npc: 'tang_bohu', name: '送给听雨轩的那幅画', level: 12,
  room: 'jn_brothel_2',
  desc: '唐寅把一卷画推过来，笔都懒得收：「你去替我看看，那地方配不配挂它。」',
  stageDesc: '把画送到醉春楼·听雨轩',
  effects: [
    { type: 'narrate', raw: '推开听雨轩的门，琵琶声正好断在半拍上。一卷画摊开，满屋子的人都静了一息。' },
    { type: 'say', raw: '「……他画的是谁？」问话的是柳含烟，眼睛却还落在画上。' },
    { type: 'menu', raw: '这一句怎么答|照实说，他是随手画的>flag:hk_tang_bohu_honest;+exp:140;+pot:48;favor:tang_bohu:8;favor:liu_hanyan:10;;说这是专为她画的>flag:hk_tang_bohu_flatter;+exp:100;+pot:30;+money:60;+karma:-3;favor:tang_bohu:12' },
  ],
  outro: '唐寅听完，把笔搁下了：「你倒是会说。」他到底没问那幅画挂上了没有。',
}));

/* ---- 祝允明：念一遍那篇序 ---- */
Q.push(sq({
  id: 'hk_zhu_zhishan', npc: 'zhu_zhishan', name: '念一遍那篇序', level: 10,
  room: 'jn_teahouse',
  desc: '祝允明把一篇新序塞给你，嗓门压得再低也压不住：「你去茶馆念一遍，看有没有人听不下去。」',
  stageDesc: '去东市·老茶馆，把那篇序念一遍',
  effects: [
    { type: 'narrate', raw: '你念到一半，堂里就有人笑出了声，也有人把茶碗放下认真听。念完，最里头那位老者点了点头。' },
    { type: 'say', raw: '「字是好字，气太盛了。」老者说，「写的人还年轻。」' },
    { type: 'menu', raw: '回去怎么说|原话告诉他>flag:hk_zhu_zhishan_true;+exp:130;+pot:44;+karma:2;favor:zhu_zhishan:10;;只说有人叫好>flag:hk_zhu_zhishan_kind;+exp:90;+pot:28;+money:80;+karma:-2;favor:zhu_zhishan:4' },
  ],
  outro: '祝允明听完哈哈大笑，笑完把纸揉了：「气太盛——说的是道理。」',
}));

/* ---- 文徵明：不肯画应酬 ---- */
Q.push(sq({
  id: 'hk_wen_zhengming', npc: 'wen_zhengming', name: '退回去的那张贴子', level: 14,
  room: 'jn_gongyuan_hall',
  desc: '文徵明把一张烫金帖子推给你：「你替我送回去。话要说得客气，意思不能软。」',
  stageDesc: '把帖子退回贡院·考棚那位老爷手上',
  effects: [
    { type: 'narrate', raw: '那位老爷接过帖子，指头在烫金边上压了压，笑容没变，眼睛冷了一层。' },
    { type: 'say', raw: '「文衡山还是这个脾气。」他把帖子收进袖里，「你回去告诉他，我记着。」' },
    { type: 'menu', raw: '这话带不带回去|一字不改地带回去>flag:hk_wen_zhengming_hard;+exp:160;+pot:52;+rep:*:3;+karma:2;favor:wen_zhengming:12;;替他缓一句，说是自己多嘴>flag:hk_wen_zhengming_soft;+exp:110;+pot:34;+money:120;+karma:-2;favor:wen_zhengming:4' },
  ],
  outro: '文徵明听完，提笔蘸了墨，又放下了：「难为你了。」',
}));

/* ---- 周文宾：合一出戏 ---- */
Q.push(sq({
  id: 'hk_zhou_wenbin', npc: 'zhou_wenbin', name: '唱完再掀冠', level: 16,
  room: 'jn_brothel_2',
  desc: '周文宾递过来一身行头：「今夜听雨轩的曲会，缺个搭戏的。你只管站着，别的我来。」',
  stageDesc: '到醉春楼·听雨轩陪他唱完这一出',
  effects: [
    { type: 'narrate', raw: '他唱到最后一句，抬袖一举，满座屏息。唱完把冠一掀——静了一息，接着是笑、是恼、是拍案。' },
    { type: 'say', raw: '「如何？」他歪着头看你，「这一个愿，你替我圆不圆？」' },
    { type: 'menu', raw: '这一场怎么收|替他把场子圆下来>flag:hk_zhou_wenbin_round;+exp:150;+pot:50;favor:zhou_wenbin:14;favor:liu_hanyan:6;;由着满座去哄笑>flag:hk_zhou_wenbin_leave;+exp:100;+pot:30;+karma:-4;favor:zhou_wenbin:-6' },
  ],
  outro: '散场后他卸了行头，走过来拍拍你的肩：「你是头一个不笑出声的。」',
}));

/* ---- 徐祯卿：要一句真话 ---- */
Q.push(sq({
  id: 'hk_xu_zhenqing', npc: 'xu_zhenqing', name: '一句真话', level: 12,
  room: 'jn_teahouse',
  desc: '徐祯卿把自己的诗稿拍在你手上：「拿去茶馆，念给一个肯说真话的人听。恭维我的话，我听过太多了。」',
  stageDesc: '去东市·老茶馆，听一句真的评语回来',
  effects: [
    { type: 'narrate', raw: '茶馆里那位抄书的先生听完，把纸推回来，只用指甲划了三处，又划掉一处。' },
    { type: 'say', raw: '「这三句是好的。」他说，「划掉那句，是他自己也知道不好。」' },
    { type: 'menu', raw: '怎么转述|一字不落地告诉他>flag:hk_xu_zhenqing_true;+exp:150;+pot:52;favor:xu_zhenqing:14;;拣好听的说>flag:hk_xu_zhenqing_soft;+exp:90;+pot:26;favor:xu_zhenqing:-4' },
  ],
  outro: '徐祯卿盯着那四处划痕看了很久，忽然笑了：「这个人，我该去见一面。」',
}));

/* ---- 张灵：一坛不带目的的酒 ---- */
Q.push(sq({
  id: 'hk_zhang_ling', npc: 'zhang_ling', name: '一坛不带目的的酒', level: 8,
  room: 'jn_wine_house',
  desc: '张灵把最后几文钱塞给你：「打一坛。不要好的，要烈的。别跟掌柜说是我要。」',
  stageDesc: '去东市·醉仙楼打一坛烈酒',
  effects: [
    { type: 'narrate', raw: '掌柜听说不要好的要烈的，笑了一声，从最里头搬出一坛封泥都裂了的。' },
    { type: 'say', raw: '「告诉他，」掌柜拍拍坛子，「这坛我留了六年，就等一个不图别的的人来买。」' },
    { type: 'menu', raw: '这坛酒怎么用|照原话告诉他>flag:hk_zhang_ling_plain;+exp:110;+pot:40;favor:zhang_ling:12;;自掏腰包换一坛好的>flag:hk_zhang_ling_rich;+exp:130;+pot:36;+money:-80;favor:zhang_ling:8;+karma:3' },
  ],
  outro: '张灵抱着坛子坐了半宿，谁也没叫。第二天他把坛底剩下的那半碗留给了你。',
}));

/* ---- 都穆：那一卷缺页 ---- */
Q.push(sq({
  id: 'hk_du_mu', npc: 'du_mu', name: '缺掉的那一页', level: 15,
  room: 'jn_teahouse',
  desc: '都穆把一函书交到你手上，指腹在中间那段空处按了按：「东市茶馆有个抄书的，你去看看他那儿有没有另一本。」',
  stageDesc: '去东市·老茶馆，找那位抄书的对一对',
  effects: [
    { type: 'narrate', raw: '抄书先生翻开自己那本，两页一并，缺的那一段正好补上了。他抄手就写，写完把纸吹干，却停下了。' },
    { type: 'say', raw: '「这一段……写出来，怕是要得罪人。」' },
    { type: 'menu', raw: '这一段怎么办|照抄带走，原样交给都穆>flag:hk_du_mu_copy;+exp:170;+pot:56;favor:du_mu:12;+karma:2;;抄一份留下，别让都穆看见>flag:hk_du_mu_hide;+exp:140;+pot:40;+money:150;favor:du_mu:-8' },
  ],
  outro: '都穆把补上的那段读了三遍，最后说：「我找了七年，原来写的是这个。」',
}));

/* ---- 柳含烟：赎身那笔银子 ---- */
Q.push(sq({
  id: 'hk_liu_hanyan', npc: 'liu_hanyan', name: '攒了七年的东西', level: 18,
  room: 'jn_market_north',
  desc: '柳含烟把一只旧匣子推过来，声音很轻：「这里头的东西，你替我换成银子。别问来路。」',
  stageDesc: '去东市·北巷，把匣子里的东西换成银子',
  effects: [
    { type: 'narrate', raw: '北巷的当铺掌柜打开匣子，手停了停。里头是一支素银簪，样式很旧，压手。' },
    { type: 'say', raw: '「这簪子，赎不出一个人。」他把匣子推回来，「但你要赎的是谁，我可以装作不知道。」' },
    { type: 'menu', raw: '这笔账怎么算|照实价收下，把银子带回去>flag:hk_liu_hanyan_money;+money:400;+exp:180;+pot:60;favor:liu_hanyan:14;;替他多垫一笔，把簪子赎回来>flag:hk_liu_hanyan_keep;+money:-200;+exp:200;+pot:60;+karma:6;favor:liu_hanyan:20' },
  ],
  outro: '柳含烟收下东西，头一直低着。开口时声音很轻：「这话我不谢你——谢了就不像话了。」',
}));

/* ---- 周学政：那一卷落卷 ---- */
Q.push(sq({
  id: 'hk_xue_zheng', npc: 'xue_zheng', name: '落卷上的那行批语', level: 20,
  room: 'jn_gongyuan_hall',
  desc: '周学政把一卷卷子搁在你面前：「你去考棚，把这卷的批语抄下来。抄的时候别让人看见。」',
  stageDesc: '去贡院·考棚抄下那行批语',
  effects: [
    { type: 'narrate', raw: '考棚里空得很。你翻开那一卷，末尾有一行小字，墨色比正文淡：此生文气有余，骨头不足。' },
    { type: 'say', raw: '（你想起那位提学看人时的眼神——很沉。）' },
    { type: 'menu', raw: '抄不抄全|照原样全抄回去>flag:hk_xue_zheng_full;+exp:200;+pot:64;+rep:*:4;favor:xue_zheng:14;;只抄前一句，后半句略过>flag:hk_xue_zheng_half;+exp:150;+pot:44;favor:xue_zheng:6;+karma:-2' },
  ],
  outro: '周学政对着那行字坐了很久，最后把它看了三遍，收进袖里：「我记下了。」',
}));

/* ---------- 校验 + 落盘 ---------- */
const ids = Q.map(q => q.id);
if (new Set(ids).size !== ids.length) throw new Error('支线 id 重复');
for (const q of Q) {
  if (!w.data.npcs[q.giver]) throw new Error('NPC 不存在：' + q.giver);
  for (const t of q.stages[0].targets) if (!w.data.rooms[t.key]) throw new Error('房间不存在：' + t.key);
}

const out = {
  _note: '据画像写的九条支线（江南七才子 + 花魁 + 提学）。画像 → 支线：他想要什么，就是他请你帮的忙。目标一律用 kind:room（有推进点），抉择走 menu 且两边都有代价。',
  quests: Object.fromEntries(Q.map(q => [q.id, q])),
  npcs: Object.fromEntries(Q.map(q => [q.giver, { sidequest: q.id }])),
};
fs.writeFileSync(path.join(ROOT, 'game', 'data', '98_sidequests_culture.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('写入', Q.length, '条支线 →', ids.join(' '));
