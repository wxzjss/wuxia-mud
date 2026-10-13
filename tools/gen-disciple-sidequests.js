/* gen-disciple-sidequests.js —— 给门派弟子写「真支线」（design/71 §四 缺口 2）
 *
 * 为什么做这个：
 *   ① smoke-social 的「被豁免的 NPC 占比 < 75%」被新加的 165 个弟子顶破了
 *      （399/526 = 75.9%）。弟子原本 sidequest 全是 undefined，走豁免规则 3。
 *   ② 但**不能靠放宽阈值糊过去** —— 那条断言守的是「豁免规则没退化成恒真」。
 *      正解是给弟子真的写支线：有委托、有目标、有回报。
 *   ③ 弟子是玩家在门派里最常说话的人，给他一件「替师兄跑个腿」的小事，
 *      门派才像个能待的地方，而不是一堆站桩的木桩。
 *
 * 设计口径（主人 2026-10-13 钦定的调子）：
 *   - 一流 6、二流 4、其余 3 门派各有 1 名弟子挂一条（43 条），不再往里堆量。
 *   - **小人物干小差事**：不派「刺探魔教」这种主线级别的活，
 *     派的是「去藏经阁把某本书抄回来」「把药送到客院」「山门口来了个人你去看看」。
 *     弟子是记名弟子，上面有师兄师姐、掌门长老，用不着他办大事。
 *   - 目标房**限本门自家房间**（拿 sectId 前缀筛），不得跑到别家门里去。
 *   - 奖励按弟子 level 缩放，不给名兵名药，只给 exp/pot + 好感。
 *
 * 输出：game/data/44_disciple_sidequests.json（ quests 键，对齐 60_quests.json 结构）
 *       并就地改写 43_sect_disciples.json 里被指派弟子的 sidequest 字段。
 *
 *⚠ 与 gen-sect-disciples.js 的执行顺序：必须**先**跑 gen-sect-disciples.js，
 *   本工具要按 `disciple_<sectId>_<i>` 去认人；弟子文件被重生成后本工具要重跑。
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'game', 'data');
const load = f => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const sectsAll = load('30_sects.json').sects;
const tiers = load('72_sects_tier.json').sects;
const sects = Object.assign({}, tiers, sectsAll);
const disFile = load('43_sect_disciples.json').npcs;
const discipleNote = load('43_sect_disciples.json')._note;

/* 全库房间（按 id 前缀筛本门自家） */
const rooms = {};
for (const f of fs.readdirSync(dataDir).sort()) {
  if (!/^\d+_.*\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  Object.assign(rooms, (j && j.rooms) || {});
}
const roomIds = Object.keys(rooms);

/* 差事文本池：按门派气质分四组。
   ⚠ 每条都要能对应上一个**具体**的本门房间；写不出具体地点的活儿别放进来。 */
const ERRAND = {
  /* 正经门派：抄书、送信、清点库房 */
  wen: [
    { name: '抄经', to: '_library', ask: '把《{book}》从头抄一卷，师父要逐字对。', book: true, back: '师父看完点头，说你字比去年稳了。' },
    { name: '清点库房', to: '_vault', ask: '库房那几箱东西今年没点过，你去数一遍，缺了报我。', back: '你报上来的数他记在册子末尾，末尾那一行他看了两遍。' },
    { name: '送信', to: '_hall', noGate: true, ask: '这封信送进去，别拆。', back: '信交到人了，他回你一句「顺路就好」，你说不顺路，他也就不多问了。' },
    { name: '换岗', to: '_hall', noGate: true, ask: '后半夜的岗你替我盯着，我去睡两个时辰。', back: '天亮他来接班，看了你一眼：「还行，没打瞌睡。」' },
    { name: '还书', to: '_library', ask: '有人借走那卷《{book}》一直没还，你替我去要。', back: '书要回来了，缺了三页。他没追究，只说：「下回我亲自去。」' },
    /* 侠客岛整座岛只有内堂/石室/渡口三间，没有藏经阁 —— 得有个能落到石室的活儿 */
    { name: '磨石', to: '_dong', ask: '石室里的碑文要拓一份，磨墨研好等我回来。', back: '你拓的那份字口清楚。他看了两行，抬头问：「谁教你的刀法？」' },
  ],
  /* 佛道：上香、扫院、抄经 */
  dao: [
    { name: '扫院', to: '_hall', noGate: true, ask: '院子里的落叶扫一扫，师父们午课要过去。', back: '扫完他自己在廊下站了一会儿，什么也没说。' },
    { name: '抄经', to: '_library', ask: '经卷要补抄，缺的那几页你补上。', back: '你把补好的经卷交回去，他翻开对了一眼折角的地方。' },
    { name: '取物', to: '_vault', ask: '库房里有样东西要挪到后面去，你帮我抬。', back: '抬完了他多给了你两文钱：「拿着，跑腿的也要吃饭。」' },
    { name: '换灯', to: '_hall', noGate: true, ask: '殿上长明灯该换油了，你换两盏。', back: '换完他过来看了一眼灯芯的长短，转身又走了。' },
    { name: '晒经', to: '_library', ask: '雨快来了，把外面晾的经卷收进来。', back: '经卷没淋着。他在廊下看了一眼天，说：「算你赶得巧。」' },
    { name: '挑水', to: '_hall', noGate: true, ask: '后山那眼泉眼的水缸空了，挑满。', back: '缸满了。他舀了一瓢尝了尝：「行了，下去歇着吧。」' },
  ],
  /* 镖帮帮会：押一趟、收一趟账、盯梢（不是杀人，是看人） */
  shi: [
    { name: '收账', to: '_hall', noGate: true, ask: '山下那家欠着咱们的账，去问一声，问清了就回话，别动手。', back: '账收回来了。他把钱往袖里一揣：「记你一功。」' },
    { name: '押货', to: '_gate', gateOnly: true, ask: '有批货要过山门，你跟着车走一趟，看着别让人碰。', back: '车到了。他拍你肩膀那一下很重：「下回还是你。」' },
    { name: '看人', to: '_gate', gateOnly: true, ask: '山门口蹲半天，看有没有生面孔打咱们这儿过。', back: '你说没看出生面孔。他「嗯」了一声，像是信了。' },
    { name: '修车', to: '_hall', ask: '院里那辆车轴又歪了，你修修。', back: '车修好了。他试推了两圈，回头看你一眼：「这个学得快。」' },
    { name: '送信', to: '_hall', noGate: true, ask: '这封信送进去，别拆。', back: '信交上去了。他出来时顺手拍了拍你的肩。' },
    { name: '守夜', to: '_hall', noGate: true, ask: '今晚你守后半夜，我这把老骨头撑不住了。', back: '天亮他来接班，往你手里塞了个馒头：「吃了再走。」' },
    /* 丐帮没有大殿，只有破庙 / 石阶 / 松林 / 山泉 —— 这几样才是他们能使唤人的地方 */
    { name: '上山下山', to: '_path1', ask: '石阶上的柴禾散了，你捡回来。', back: '柴禾捆好往墙根一靠，他接着说：「过两天还有一趟。」' },
    { name: '洗伤', to: '_path5', ask: '山泉边有几个弟兄伤了，你去给上药。', back: '上完药他没留你，只在你背后说了句「辛苦了」。' },
    { name: '看渡口', to: '_dukou', gateOnly: true, ask: '渡口这几天有没有生面孔上下船，你盯着。', back: '你说没有。他「嗯」了一声，把酒壶推给你：「喝一口暖暖。」' },
  ],
  /* 邪道：探路、盯梢、跑腿 —— 邪道弟子的活更脏一点，但也不上升成大案 */
  cao: [
    { name: '跑腿', to: '_vault', ask: '去库房把东西取来，取的时候别点灯。', back: '东西交到他手里，他掂了掂，扔给你一个荷包。' },
    { name: '看人', to: '_gate', ask: '山门外那几个人盯一晚上，天亮报我。', back: '你报完他沉默了一会儿：「你说没动手？很好，记住这句话。」' },
    { name: '递话', to: '_hall', ask: '去把这句话带给那边的人，一个字都别添。', back: '话带到了。他「嗯」了一声，然后让你退下。' },
    { name: '埋东西', to: '_gate', gateOnly: true, ask: '山门外柳树底下有样东西，埋深些。', back: '埋完他拍掉你手上的土：「今天谁问起都说不知道。」' },
    { name: '认路', to: '_hall', ask: '外头那条道你走过没有？没走过就去走一趟，认熟了再回来。', back: '你回来时他正擦一把刀，头也不抬：「认熟了就好。」' },
  ],
};

const BOOK = ['混元功', '太极心法', '剑冢笔记', '拳要', '医方', '残局谱', '内息诀', '吐纳篇'];

function groupOfMood(sectId) {
  const s = sects[sectId] || {};
  const a = s.align || '中立';
  const n = s.name || '';
  if (a === '邪道') return 'cao';
  if (/镖局|帮|会/.test(n)) return 'shi';
  if (/少林|武当|峨眉|青城|崆峒|昆仑|古墓|点苍|泰山|衡山|恒山/.test(n)) return 'dao';
  return 'wen';
}

/* 目标房：本门房间里挑。
   ⚠ **只认后缀命中，命中不了就返回 null**（由主循环换下一条活儿）。
     上一版有「任意本门房间」的兜底，结果华山送信送到山道下、
     血刀「山门外盯人」跑到藏经阁 —— 差事和地点对不上，玩家一看就出戏。
     「送进大殿」「埋到山门外」这种活儿，地点不配就等于没派。 */
function pickRoom(sectId, suffix, selfRoom, noGate, gateOnly) {
  const own = roomIds.filter(r => r.startsWith(sectId + '_'));
  if (!own.length || !suffix) return null;
  const gatey = r => /shanmen|_shan$|_gate$|_men$|_dukou$/.test(r);
  const hit = own.find(r => r.endsWith(suffix) && r !== selfRoom);
  if (!hit) return null;
  if (noGate && gatey(hit)) return null;
  if (gateOnly && !gatey(hit)) return null;
  return hit;
}

/* ---- 主流程 ---- */
const out = { _note: [
  '43 门派弟子支线（design/71 §四 缺口 2 的补法）。',
  '每门派挑一名弟子挂一条「小差事」——不是主线级别的委托，就是同门里跑腿、抄书、收账。',
  '目标房限本门自家房间（按 sectId 前缀筛），不许跨门派。',
  '奖励只给 exp / pot / 好感 —— 记名弟子办这种活，论不上名兵名药。',
  '⚠ 依赖 43_sect_disciples.json 的 disciple_<sectId>_<i> 命名，弟子文件重生成后本文件要重跑。',
], quests: {} };

let made = 0, skip = [];
const dis = Object.values(disFile).filter(n => n.job === 'disciple');
const bySect = {};
for (const n of dis) (bySect[n.sect] = bySect[n.sect] || []).push(n);

for (const sectId of Object.keys(sects)) {
  const arr = bySect[sectId];
  if (!arr || !arr.length) { skip.push(sectId + '(无弟子)'); continue; }
  /* 挑人：取 rank 最小（辈分最靠前但不是掌门那一层）的那个 ——
     资历最深又非掌门的人才好意思派活，且跟 A 层人物不撞位。 */
  const who = arr.slice().sort((x, y) => (x.rank || 0) - (y.rank || 0) || (x.level || 0) - (y.level || 0))[0];
  const grp = groupOfMood(sectId);
  const pool = ERRAND[grp] || ERRAND.wen;
  /* 轮着换活，别一个门派的弟子全在干同一件事 */
  /*轮换键：用 sectId 的散列而不是名字长度 ——
     原来用 name.length，三流帮会的名字长度挤在同一档，
     结果八个镖局八个帮会全是「收账」，一眼假。 */
  let h = 2166136261 >>> 0;
  for (const ch of sectId) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let idx = h % pool.length;
  let e = pool[idx];
  let room = pickRoom(sectId, e.to, who.room, e.noGate, e.gateOnly);
  /* 挑不到合适的房（比如这个门派只有 vault，而这活儿要送正殿），
     就顺着往后找一条能干上的 —— 宁可换个活儿，不要让「取物」跑到山门口去。 */
  for (let t = 1; !room && t < pool.length; t++) {
    const c = pool[(idx + t) % pool.length];
    const r = pickRoom(sectId, c.to, who.room, c.noGate, c.gateOnly);
    if (r) { e = c; room = r; }
  }
  if (!room) { skip.push(sectId + '(无房)'); continue; }

  const qid = 'sqd_' + sectId;
  const book = BOOK[(who.name || '').length % BOOK.length];
  const ask = (e.ask || '').replace('{book}', book);
  const lv = who.level || 10;

  out.quests[qid] = {
    id: qid,
    name: sectName(sectId) + '·' + e.name,
    level: lv,
    type: '支线',
    giver: who.id,
    desc: who.name + '（' + (who.title || '弟子') + '）拦着你：「既是同门，帮我个忙 —— ' + ask + '」',
    stages: [
      {
        desc: roomLabel(room) + '：' + ask.replace(/^你/, '我').replace(/「.*$/, ''),
        targets: [
          { id: 'go', kind: 'room', key: room, desc: roomLabel(room), count: 1, var: qid + '_go' },
        ],
        cond: { var: qid + '_go' },
        next: 1,
      },
      { desc: '回去向' + who.name + '复命', next: 99 },
    ],
    rewards: [
      { type: '+exp', args: [Math.round(60 + lv * 12)] },
      { type: '+pot', args: [Math.round(25 + lv * 5)] },
      { type: 'favor', args: [who.id, 6] },
      { type: 'say', raw: who.name + e.back },
    ],
  };

  /* 就地回填：让引擎/前端知道这条挂在这个弟子身上 */
  disFile[who.id].sidequest = qid;
  made++;
}

function sectName(id) { return (sects[id] && sects[id].name) || id; }
function roomLabel(id) { return (rooms[id] && rooms[id].name) || id; }

/* ---- 落盘：sidequest 字段就地改回43 文件（保持生成器可重跑） ---- */
fs.writeFileSync(path.join(dataDir, '44_disciple_sidequests.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
/*⚠ disFile 本身就是 npcs 表（上面 `load(...).npcs`），这里**不能**再取一次 `.npcs`
   —— 取了就把文件写成 `{"npcs":{}}`，165 个弟子当场全没，
     而日志还照样打印「生成 43 条」，看着一切正常（踩过一次）。
     写完必须自己 `Object.keys(npcs).length` 数一遍再收工。 */
fs.writeFileSync(path.join(dataDir, '43_sect_disciples.json'), JSON.stringify({ _note: discipleNote, npcs: disFile }, null, 2) + '\n', 'utf8');

console.log(`生成弟子支线: ${made} 条` + (skip.length ? `（跳过 ${skip.length}：${skip.join(' ')}）` : ''));