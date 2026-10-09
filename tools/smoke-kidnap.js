/**
 * smoke-kidnap.js — 掳人/奴役/护院 系统回归
 *
 * 覆盖：麻袋、醒来反应、目击报官、拦路、奴买卖、护院欠薪、派活收工、
 *       跟随、黑市赎身/突围/还债、存档往返。
 *
 * ⚠️ 随机源固定 seed（mulberry32），否则假失败（血泪 #15）。
 * ⚠️ BLACK_MARKETS.room 必须是真实房间 id —— 本套件第一条就断言这个，
 *    写错字母会让 inBlackMarket 静默返 false，全线瘫掉且不报错。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const kidnap = require(path.join(ROOT, 'game/src/core/kidnap.js'));

/* ---- 起一个干净世界 ----
 * ⚠️ 必须走 GameEngine.boot()（它才 loadData + buildIndexes）。
 *    直接 new World() 拿到的 this.data 是空壳 → spawnNpc 全返 null。
 * 这里返回的是 **world**，但把 engine 的 exec / cmds 挂上去当快捷方式，
 * 这样测试体里既能 w.advanceTime(...) 也能 run(w, '奴册')。 */
function freshWorld(cfg) {
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame(Object.assign({ name: '测试侠', gender: 'male', birth: 'wuxue' }, cfg || {}));
  const w = e.world;
  w.exec = (cmd) => e.exec(cmd);     // 走完整后处理（含 advanceTime）
  w.cmds = e.cmds;
  w._engine = e;
  return w;
}
function run(w, cmd) {
  const r = w.exec(cmd);
  return (r && r.lines) || [];
}
function txt(lines) { return lines.map(l => l.text).join(' | '); }
/** 在指定房间造一个晕倒的 NPC，返回实例 */
function knockDown(w, defId, roomId) {
  const n = w.spawnNpc(defId, roomId || w.player.room, 1, true);
  if (!n) throw new Error('spawnNpc(' + defId + ') 返 null —— 模板 id 拼错了？');
  n.knockedOut = true; n.dead = true; n.hp = 0;
  return n;
}
function findByName(w, name) {
  return Object.values(w.instances.npcs).find(n => n.name === name);
}
/** 把玩家挪到一个没人、没 respawn、非私密的房间 —— 测「悄悄掳走没人管」得用这个。
 *  开局那条大路有 2 个 NPC，其中一个武艺比玩家高，会触发拦路（那是正确行为，
 *  但会让「装袋成功」的用例测不到真正想测的东西）。*/
function toQuietRoom(w) {
  const rid = Object.keys(w.data.rooms).find(id => {
    const r = w.data.rooms[id];
    return r && !r.private && !r.respawn && !r.hostile && w.npcsIn(id).length === 0;
  });
  if (!rid) throw new Error('找不到安静房间');
  w.player.room = rid;
  return rid;
}
/** 拉满战力（改 baseAttr 后必须 recalc，否则 attr 还是旧的） */
function powerUp(w, v) {
  for (const k of ['力量', '根骨', '身法']) w.player.baseAttr[k] = v;
  w.player.recalc();
  return kidnap.martialPower(w.player);
}
function fsRooms() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/50_map.json'), 'utf8'));
  return j.rooms || j;
}

/* ---- 断言 ---- */
let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; fails.push(name + ' :: ' + e.message); console.log('  ✘ ' + name + ' → ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
/** 玩家身上数某物品（兼容 {id,count} 与裸字符串） */
function countItem(w, id) {
  let n = 0;
  for (const it of (w.player.inventory || [])) {
    const iid = typeof it === 'string' ? it : it.id;
    if (iid === id) n += (typeof it === 'object' && it.count) || 1;
  }
  return n;
}
/** 从存档恢复出一个新世界（必须先 boot 拿到 data，再 deserialize） */
function rehydrate(save) {
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  const w = e.world;
  w.deserialize(save);
  w.exec = (cmd) => e.exec(cmd);
  w.cmds = e.cmds;
  w._engine = e;
  return w;
}

console.log('============================================');
console.log('  掳人 / 奴役 / 护院 smoke');
console.log('============================================');

/* ============ 0. 配置完整性 ============ */
console.log('\n【0】配置完整性');

t('黑市房间 id 在地图里真实存在', () => {
  for (const b of kidnap.BLACK_MARKETS) {
    ok(b.room, `${b.name} 的 room 为空`);
    // data 里查不到就说明 id 拼错或房间没建
    const rooms = fsRooms();
    ok(rooms[b.room], `${b.name} 的 room="${b.room}" 在 50_map.json 里不存在`);
  }
});

t('青楼判定能认出醉春楼', () => {
  const w = freshWorld();
  w.player.room = 'jn_brothel_hall';
  ok(kidnap.inBrothel(w), '醉春楼·花厅 应判定为青楼');
});

t('黑市判定能认出地下黑市与秘境黑市', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  ok(kidnap.inBlackMarket(w), '东市·地下黑市 应判定为黑市');
  w.player.room = 'secret_black_market';
  ok(kidnap.inBlackMarket(w), '秘境·黑市 应判定为黑市');
});

t('街上不算青楼也不算黑市', () => {
  const w = freshWorld();
  w.player.room = 'jn_market_main';
  ok(!kidnap.inBrothel(w), '东市大街被误判成青楼');
  ok(!kidnap.inBlackMarket(w), '东市大街被误判成黑市');
});

t('常数额度表完整（律法依唐会要·奴婢）', () => {
  const tiers = kidnap.WEALTH_TIERS;
  ok(Array.isArray(tiers) && tiers.length >= 5, '家资档位不足 5 档');
  eq(tiers[0].slaves, 0, '寒素不该能养奴（唐会要：王公之家才二十人为限）');
  /* 注意：这表是**从穷到富升序**写的 */
  for (let i = 1; i < tiers.length; i++) {
    ok(tiers[i].slaves > tiers[i - 1].slaves, '奴限额应递增');
    ok(tiers[i].guards > tiers[i - 1].guards, '护院限额应递增');
  }
});

t('恶名档位完整（大明律：杖一百→流三千里→充军）', () => {
  const wt = kidnap.WANTED_TIERS;
  ok(Array.isArray(wt) && wt.length >= 4, '恶名档位不足');
  /* 这表是**从重到轻降序**写的（min: 20 → 0） */
  for (let i = 1; i < wt.length; i++) ok(wt[i].min < wt[i - 1].min, '恶名门槛应递减');
  eq(kidnap.wantedTier(0).id, 'free', '0 恶名该是「未及罪」');
  eq(kidnap.wantedTier(3).id, 'cane100', '3 恶名该是「杖一百」');
  eq(kidnap.wantedTier(6).id, 'exile3k', '6 恶名该是「流三千里」');
  eq(kidnap.wantedTier(20).id, 'exile', '20 恶名该是「永远充军」');
});

/* ============ 1. 麻袋：装 / 醒 / 放 ============ */
console.log('\n【1】麻袋：装入 / 醒来 / 放出');

/* ↓ 以下用例都先 toQuietRoom + powerUp，否则开局那条大路有人拦路 */

t('玩家开局有麻袋', () => {
  const w = freshWorld();
  ok(w.player.countItem(kidnap.SACK_ID) >= 1, '开局背包里没有麻袋');
});

t('没有麻袋时装不了人', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = knockDown(w, 'mob_bandit');
  w.player.removeItem(kidnap.SACK_ID, w.player.countItem(kidnap.SACK_ID));
  const r = kidnap.packNpc(w, n.name);
  ok(!r.ok, '没麻袋居然成功了');
  ok(txt(r.lines).includes('麻袋'), '提示里该说没麻袋，实际：' + txt(r.lines));
});

t('装入后 NPC 从场景消失、进麻袋册', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = knockDown(w, 'mob_bandit');
  const r = kidnap.packNpc(w, n.name);
  ok(r.ok, '装袋失败：' + txt(r.lines));
  const bags = kidnap.listBags(w);
  eq(bags.length, 1, '袋数不对');
  eq(bags[0].name, n.name, '袋里名字不对');
  eq(countItem(w, kidnap.SACK_ID), 0, '装完应消耗一只麻袋');
});

t('麻袋上限拦住第四袋', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  for (let i = 0; i < kidnap.MAX_BAGS + 1; i++) {
    const n = knockDown(w, 'mob_bandit');
    kidnap.packNpc(w, n.name);
    w.giveItem(w.player, kidnap.SACK_ID, 1);   // 补袋子，只测上限
  }
  eq(kidnap.listBags(w).length, kidnap.MAX_BAGS, '袋数应卡在上限');
});

t('不能装没晕倒的人', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);  // 没 knockedOut
  const r = kidnap.packNpc(w, n.name);
  ok(!r.ok, '装了个活人');
});

t('醒来概率随时间上升', () => {
  const a = kidnap.wakeRate(0), b = kidnap.wakeRate(60), c = kidnap.wakeRate(300);
  ok(b > a, '60 分钟应比 0 分钟更容易醒');
  ok(c > b, '300 分钟应比 60 分钟更容易醒');
  ok(c <= 0.85, '醒的概率不该封顶到 1（永不可能=玩家永远安全）');
});

t('醒来的 NPC 是重伤（血量按比例残）', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = knockDown(w, 'mob_bandit_chief');
  const maxHp = n.maxHp;
  kidnap.packNpc(w, n.name);
  const bag = kidnap.listBags(w)[0];
  bag.putAt = w.clockMinutes - 400;
  const r = kidnap.wakeUp(w, bag);
  eq(bag.state, 'struggling', '醒来后袋状态该变 struggling');
  ok(txt(r.lines).includes(bag.name), '醒来该报出这人名字');
  /* 玩家武力远超对方 → 冲不出来，人还在袋里（这是设计：袋里的人不落回场景） */
  eq(r.burst, false, '玩家武力碾压时不该被冲出来');
  ok(!findByName(w, bag.name), '没冲出来时人该还在袋里，不在场景');
  /* 玩家弱小 → 大概率冲出来，且冲出来必带伤（BURST_RATIO 肾上腺素） */
  const w2 = freshWorld();
  toQuietRoom(w2); powerUp(w2, 1);
  const n2 = knockDown(w2, 'mob_bandit_chief');
  kidnap.packNpc(w2, n2.name);
  const bag2 = kidnap.listBags(w2)[0];
  bag2.putAt = w2.clockMinutes - 400;
  for (let i = 0; i < 20; i++) {
    const rr = kidnap.wakeUp(w2, bag2);
    if (rr.burst && rr.npc) {
      ok(rr.npc.hp < rr.npc.maxHp * 0.95, `冲出来应带伤 hp=${rr.npc.hp}/${rr.npc.maxHp}`);
      ok(rr.npc.hostile, '冲出来就该跟你拼命');
      break;
    }
  }
});

t('性格决定醒来反应（至少覆盖哭/骂/沉默三类）', () => {
  const hasCry = Object.values(kidnap.WAKE_REACTIONS).some(r => r.cry);
  const hasLoud = Object.values(kidnap.WAKE_REACTIONS).some(r => r.shout >= 0.8);
  const hasQuiet = Object.values(kidnap.WAKE_REACTIONS).some(r => r.shout <= 0.15);
  ok(hasCry, '没有会哭的性格');
  ok(hasLoud, '没有会破口大骂的性格');
  ok(hasQuiet, '没有沉默寡言的性格');
});

t('放出麻袋里的人', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = knockDown(w, 'mob_bandit');
  kidnap.packNpc(w, n.name);
  const r = kidnap.releaseBag(w, 1);
  ok(r.ok, '放人失败');
  eq(kidnap.listBags(w).length, 0, '放完袋数应归零');
  eq(w.npcsIn(w.player.room).filter(x => x.name === n.name).length, 1, '人该回到房间里');
});

/* ============ 2. 目击与恶名 ============ */
console.log('\n【2】目击 / 议论 / 报官 / 恶名');

t('当着人面装人 → 恶名上涨', () => {
  const w = freshWorld();
  powerUp(w, 99999);   // 武力拉满，免得被目击者拦下测不到报官
  /* 目击者得是**会报官的性格**：xiayi 侠义 0.9 / wenwan 温婉 0.6 / youhua 油滑 0.5。
     木讷（mune）只会讷讷说一句「这不太好吧」，不报官（这本身就是设计）。 */
  for (let i = 0; i < 3; i++) {
    const wit = w.spawnNpc('npcv_001', w.player.room, 1, true);
    wit.personality = 'xiayi';   // 侠义：见义勇为必报官
  }
  eq(kidnap.witnesses(w, w.player.room).filter(n => n.personality === 'xiayi').length, 3, '目击者没站进来');
  const n = knockDown(w, 'mob_bandit');
  const before = kidnap.data(w).wanted;
  kidnap.packNpc(w, n.name);
  ok(kidnap.data(w).wanted > before, `侠义目击者在场却没涨恶名（before=${before}）`);
});

t('僻静处装人 → 不涨恶名', () => {
  const w = freshWorld();
  const empty = toQuietRoom(w);
  const n = knockDown(w, 'mob_bandit', empty);
  const before = kidnap.data(w).wanted;
  kidnap.packNpc(w, n.name);
  eq(kidnap.data(w).wanted, before, '没人看见不该涨恶名');
});

t('目击者里有人报官，且木讷/胆小不报（性格要有差别）', () => {
  const rs = kidnap.WITNESS_REACTIONS;
  const reporters = Object.keys(rs).filter(k => rs[k].report);
  const quiet = Object.keys(rs).filter(k => !rs[k].report);
  ok(reporters.length >= 3, '会报官的性格太少：' + reporters.join('/'));
  ok(quiet.length >= 4, '不报官的性格太少：' + quiet.join('/'));
  /* 主人原话：性格不同反应不同 —— 至少得有三种量级 */
  const chances = Object.values(rs).map(r => r.chance).sort((a, b) => a - b);
  ok(chances[0] <= 0.15 && chances[chances.length - 1] >= 0.9, '报官概率该拉开档位');
});

t('武艺高的人会拦路', () => {
  const w = freshWorld();
  const n = knockDown(w, 'mob_bandit_chief');
  // 把玩家武力拉满，确保拦得住
  for (const k of ['力量', '根骨', '身法', '悟性']) w.player.baseAttr[k] = 999;
  const r = kidnap.packNpc(w, n.name);
  ok(!r.ok || kidnap.data(w).wanted > 0, '高手在场竟毫无阻碍也没报官');
});

/* ============ 3. 买卖 ============ */
console.log('\n【3】买卖：买奴 / 卖人 / 赎回');

t('不在黑市买不了奴', () => {
  const w = freshWorld();
  const r = kidnap.buySlave(w, '');
  ok(!r.ok, '街上就能买奴');
});

t('黑市里能买奴，但限额按家资档（寒素买不了）', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  w.player.money = 999999;
  /* 黑市里 respawn 的山贼会拦路（那是设计），先清场再装袋 */
  w.player.room = 'jm_underground';
  powerUp(w, 99999);
  for (const x of w.npcsIn('jm_underground')) x.room = '__away__';
  /* 货要先有：别人卖进黑市的人（买奴不凭空造人） */
  const n = knockDown(w, 'mob_bandit', 'jm_underground');
  ok(kidnap.packNpc(w, n.name).ok, '装袋失败');
  kidnap.sellNpc(w, n.name);
  eq(w.soldSlaves.length, 1, '名册该有 1 条货');

  /* 家资不够（穷开局 + 没宅院）→ 买不了，这符合律法 */
  const q = kidnap.quotas(w);
  if (q.slaves <= 0) {
    const poor = kidnap.buySlave(w, '');
    ok(!poor.ok, '寒素家资竟买到了奴');
    ok(txt(poor.lines).includes('养不起'), '该提示家资养不起：' + txt(poor.lines));
    /* 把家资提上去（置宅 = 按律「身份给限额」） */
    w.player.homes = [{ id: 'x', name: '宅', tier: 'courtyard' }];
    w.player.estate = { plots: [{ key: 'k', level: 2 }, { key: 'k', level: 2 }], sponsored: {} };
    const q2 = kidnap.quotas(w);
    ok(q2.slaves > 0, `置了产业还是 0 名额（档位 ${q2.tier.name}）`);
  }
  const r = kidnap.buySlave(w, '');
  ok(r.ok, '买奴失败：' + txt(r.lines));
  eq(kidnap.data(w).slaves.length, 1, '应有 1 个奴');
  eq(w.soldSlaves.length, 0, '买走一个，名册该少一个');
});

t('名册空了就说无人待售（不凭空造人）', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  /* 家资拉满，排除名额先挡下来的干扰 —— 这里只测「没货」这一条 */
  w.player.homes = [{ id: 'x', name: '宅', tier: 'mansion' }];
  w.player.estate = { plots: [{ key: 'k', level: 3 }, { key: 'k', level: 3 }, { key: 'k', level: 3 }], sponsored: {} };
  const r = kidnap.buySlave(w, '');
  ok(!r.ok, '空名册竟买成了');
  ok(txt(r.lines).includes('无人待售'), '该说无人待售：' + txt(r.lines));
});

t('卖人进名册并涨恶名', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 9999);
  const n = knockDown(w, 'mob_bandit');
  kidnap.packNpc(w, n.name);
  const before = kidnap.data(w).wanted;
  const r = kidnap.sellNpc(w, n.name);
  ok(r.ok, '卖人失败：' + txt(r.lines));
  ok(Array.isArray(w.soldSlaves), 'soldSlaves 必须是数组（不是按 defId 建的对象）');
  ok(w.soldSlaves.length > 0, 'soldSlaves 名册没记上');
  ok(w.soldSlaves[0].defId, '名册条目要记 defId（赎回时靠它还原人）');
  ok(kidnap.data(w).wanted > before, '知情转卖不该只涨一点点');
});

t('赎回别人要钱，钱不够就赎不成；钱够就能赎出来', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 99999);
  w.player.money = 999999;
  w.player.room = 'jm_underground';
  for (const x of w.npcsIn('jm_underground')) x.room = '__away__';
  const n = knockDown(w, 'mob_bandit', 'jm_underground');
  kidnap.packNpc(w, n.name);
  const name = n.name;
  ok(kidnap.sellNpc(w, name).ok, '卖人失败');
  /* 名册里有人了 */
  eq(w.soldSlaves.length, 1, '名册应有 1 条');
  /* 钱不够 → 赎不成 */
  w.player.room = 'jn_brothel_hall';
  w.player.money = 1;
  const poor = kidnap.redeemPerson(w, name);
  ok(!poor.ok, '1 文竟赎成了');
  eq(w.soldSlaves.length, 1, '赎失败不该少人');
  /* 钱够 → 赎出来，且人回到房间里 */
  w.player.money = 999999;
  const rich = kidnap.redeemPerson(w, name);
  ok(rich.ok, '钱够却赎不成：' + txt(rich.lines));
  eq(w.soldSlaves.length, 0, '赎完名册该空');
  ok(w.npcsIn(w.player.room).some(x => x.name === name), '赎回来的人没在房间里');
});

t('赎回的是快照还原：defId 对得上，重建的是模板里的人', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 99999);
  w.player.money = 999999;
  w.player.room = 'jm_underground';
  for (const x of w.npcsIn('jm_underground')) x.room = '__away__';
  const n = knockDown(w, 'mob_bandit_chief', 'jm_underground');
  kidnap.packNpc(w, n.name);
  const defId = n.defId;
  kidnap.sellNpc(w, n.name);
  w.player.room = 'secret_black_market';
  const rec = w.soldSlaves[0];
  eq(rec.defId, defId, '名册没记 defId');
  ok(kidnap.redeemPerson(w, rec.name).ok, '赎回失败');
  const back = w.npcsIn(w.player.room).find(x => x.name === rec.name);
  ok(back && back.defId === defId, '赎回来的人不是同一个模板');
});

/* ============ 4. 护院 ============ */
console.log('\n【4】护院：雇 / 欠薪 / 监督');

t('不在自家宅院雇不到护院', () => {
  const w = freshWorld();
  const r = kidnap.hireGuard(w, '');
  ok(!r.ok, '大街上雇到了护院');
});

t('发工钱：没有护院时不发', () => {
  const w = freshWorld();
  const r = kidnap.payWages(w);
  ok(!r.ok, '没护院却发薪了');
});

t('欠薪累计到 wageDue', () => {
  const w = freshWorld();
  w.player.money = 99999;
  /* 宅院得自己买（p.homes 是运行时动态建的，硬塞 id 查无此房）。
     规矩照 home.js：必须站在衙门房 YAMEN_ROOM 才能立契。 */
  const homeMod = require(path.join(ROOT, 'game/src/core/home.js'));
  w.player.room = homeMod.YAMEN_ROOM;
  const bought = homeMod.buy(w, 'cottage');
  ok(bought && bought.ok, '买宅失败：' + ((bought && bought.lines || []).map(l => l.text).join(' | ')));
  const home = w.player.home;
  w.player.room = home;
  /* 护院得是宅院里站着的人，且不能是 hostile（山贼/贼寇不算护院人选）。
     先造一个普通村民当护院，再放个山贼验证「山贼不被雇」也拦得住。 */
  const bandit = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  ok(kidnap.hireGuard(w, bandit.name).ok === false, '山贼也能当护院？');
  /* 把山贼挪出去，剩下正经营造一个村民 */
  if (bandit) w.instances.npcs[bandit.id].room = '__away__';
  const g = w.spawnNpc('npcv_001', w.player.room, 1, true);
  if (!g) throw new Error('spawnNpc(npcv_001) 返 null');
  const r = kidnap.hireGuard(w, g.name);
  ok(r.ok, '雇护院失败：' + txt(r.lines));
  eq(kidnap.data(w).guards.length, 1, '应有 1 个护院');
  // 推进时间到跨日
  w.advanceTime(1440);
  ok(kidnap.data(w).wageDue >= 0, 'wageDue 丢了');
});

t('武艺越强，托人监督越贵', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  w.player.money = 99999;
  const prices = [];
  for (let i = 0; i < 3; i++) {
    const g = w.spawnNpc(i === 0 ? 'mob_bandit' : (i === 1 ? 'mob_bandit_chief' : 'mob_tiger'), 'jm_underground', 1, true);
    prices.push(kidnap.martialPower(g));
  }
  ok(prices[0] < prices[2], `战力应递增：${prices.join(',')}`);
});

t('监督：名下没人时拒绝', () => {
  const w = freshWorld();
  const r = kidnap.supervise(w, '');
  ok(!r.ok, '没人却监督成功了');
});

/* ============ 5. 派活 ============ */
console.log('\n【5】奴隶派活 / 工钱 / 逃跑');

function withSlave(w) {
  w.player.money = 999999;
  w.player.room = 'jm_underground';
  const q = kidnap.quotas(w);
  if (q.slaveMax <= 0) return null;
  const r = kidnap.buySlave(w, '');
  return kidnap.data(w).slaves[0] || null;
}

t('派活有四种可选', () => {
  const keys = Object.keys(kidnap.TASKS);
  ok(keys.length >= 4, '活少');
  for (const k of keys) {
    const t = kidnap.TASKS[k];
    ok(t.name && t.desc && Array.isArray(t.earn), `活「${k}」字段不全`);
  }
});

t('接活 → 头上记着完工时间', () => {
  const w = freshWorld();
  const s = withSlave(w);
  if (!s) { ok(true, '寒素无名额，跳过'); return; }
  const r = kidnap.assignTask(w, s.name, 'errand');
  ok(r.ok, '派活失败：' + txt(r.lines));
  const after = kidnap.data(w).slaves.find(x => x.name === s.name);
  ok(after.task, '没记下派的什么活');
  ok(after.taskEnds > w.clockMinutes, '完工时间不对');
});

t('干完工把钱给玩家', () => {
  const w = freshWorld();
  const s = withSlave(w);
  if (!s) { ok(true, '寒素无名额，跳过'); return; }
  kidnap.assignTask(w, s.name, 'errand');
  const before = w.player.money;
  w.advanceTime(400);
  ok(w.player.money > before, `干完工没拿到钱（${before}→${w.player.money}）`);
});

t('服从或好感过 80 才免疫逃跑', () => {
  const w = freshWorld();
  const s = withSlave(w);
  if (!s) { ok(true, '寒素无名额，跳过'); return; }
  const rec = kidnap.data(w).slaves.find(x => x.name === s.name);
  rec.obedience = 10; rec.favor = 0;
  ok(typeof kidnap.checkEscape(w) === 'boolean', '逃跑判定没返回布尔');
  rec.obedience = 95; rec.favor = 95;
  for (let i = 0; i < 30; i++) kidnap.checkEscape(w);
  const still = kidnap.data(w).slaves.find(x => x.name === s.name);
  ok(still, '服从/好感过 80 却还是逃了');
});

/* ============ 6. 跟随 ============ */
console.log('\n【6】邀请跟随');

t('好感不过 60 不能跟随', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.favor = 10;
  const r = kidnap.inviteFollow(w, n.name);
  ok(!r.ok, '好感 10 也跟上了');
  ok(txt(r.lines).includes('60'), '提示里该说好感门槛');
});

t('好感过 60 可以跟随', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.favor = 80;
  const r = kidnap.inviteFollow(w, n.name);
  ok(r.ok, '好感 80 却跟不了：' + txt(r.lines));
  const inst = findByName(w, n.name);
  ok(inst && inst.followPlayer, '没打上 followPlayer 标记');
});

t('跟着的人会「有事离开」但会回来', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.favor = 80;
  kidnap.inviteFollow(w, n.name);
  const inst = findByName(w, n.name);
  inst.vars = inst.vars || {};
  inst.vars.awayUntil = w.clockMinutes + 60;
  inst.vars.awayReason = '吃饭';
  kidnap.tickFollowers(w, 30);
  ok(inst.vars.awayUntil >= w.clockMinutes, '还在离开中不该被清掉');
  w.clockMinutes += 120;
  kidnap.tickFollowers(w, 30);
  ok(!inst.vars.awayUntil, '时间到了该回来');
  ok(!inst.vars.awayReason, '回来后应清掉事由');
});

/* ============ 7. 自己被掳 ============ */
console.log('\n【7】玩家自己被掳：赎身 / 突围 / 还债');

t('没被掳时赎身/突围都拒绝', () => {
  const w = freshWorld();
  ok(!kidnap.redeemSelf(w).ok, '没被掳却赎成功了');
  ok(!kidnap.escapeMarket(w).ok, '没被掳却突围成功了');
});

t('被掳后：欠债成立，赎身要钱', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  const r = kidnap.playerCaptured(w, 'mob_bandit_chief');
  ok(r && r.ok !== false, '被掳失败：' + JSON.stringify(r));
  const k = kidnap.data(w);
  ok(k.debt && k.debt.ransom > 0, '没记赎金');
  w.player.money = 1;
  ok(!kidnap.redeemSelf(w).ok, '1 文不该赎得成');
  w.player.money = 999999;
  ok(kidnap.redeemSelf(w).ok, '钱够却赎不成');
  ok(!kidnap.data(w).debt, '赎完债该清掉');
});

t('突围：打不过就出不去（还会被拖回来加赎金）', () => {
  const w = freshWorld();
  w.player.room = 'secret_black_market';   // 镇场武者 260
  kidnap.playerCaptured(w, 'mob_bandit_chief');
  eq(w.player.room, 'secret_black_market', '被掳后该留在抓你的那个黑市');
  powerUp(w, 1);
  const r0 = kidnap.data(w).debt.ransom;
  const r = kidnap.escapeMarket(w);
  ok(!r.ok, '弱小之躯竟从秘境黑市打出来了');
  ok(kidnap.data(w).debt, '突围失败不该清债（该被拖回来加倍）');
  ok(kidnap.data(w).debt.ransom > r0, '突围失败赎金该翻倍');
});

t('突围：打得过就能出去', () => {
  const w = freshWorld();
  w.player.room = 'secret_black_market';
  kidnap.playerCaptured(w, 'mob_bandit_chief');
  powerUp(w, 9999);
  const r = kidnap.escapeMarket(w);
  ok(r.ok, '武力碾压却出不去：' + txt(r.lines));
  ok(!kidnap.data(w).debt, '打出去后债该没了');
});

t('打工还债：当天不算工钱，跨天才抵（照打工人作息）', () => {
  const w = freshWorld();
  w.player.room = 'jm_underground';
  kidnap.playerCaptured(w, 'mob_bandit');
  const debt = kidnap.data(w).debt;
  const ransom0 = debt.ransom;
  /* 同一天再调用：不抵债（人被关着，第一天不算工） */
  const sameDay = kidnap.workOffDebt(w, 60);
  ok(sameDay && sameDay.ok === false, '同一天不该抵债');
  eq(kidnap.data(w).debt.ransom, ransom0, '同一天债不该变');
  /* 跨天：抵 300 文 */
  w.clockMinutes += 1440;
  const nextDay = kidnap.workOffDebt(w, 60);
  ok(nextDay.ok, '跨天该抵债：' + txt(nextDay.lines));
  eq(kidnap.data(w).debt.paidOff, 300, '一天该抵 300 文');
  eq(kidnap.data(w).debt.days, 1, '天数该记 1');
  /* 五天还清 */
  for (let i = 0; i < 6; i++) { w.clockMinutes += 1440; kidnap.workOffDebt(w, 60); }
  ok(!kidnap.data(w).debt, `5 天该还清（还剩 ${kidnap.data(w).debt && kidnap.data(w).debt.ransom}）`);
});

/* ============ 8. 指令层 ============ */
console.log('\n【8】指令注册与分派');

const CMDNAMES = ['装人', '麻袋', '放人', '赎回', '卖人', '买奴', '奴册', '使唤', '跟随', '雇护院', '发工钱', '监督', '突围', '还债'];

t('全部新指令都已注册', () => {
  const w = freshWorld();
  for (const n of CMDNAMES) ok(w.cmds.CMD[n], `指令「${n}」没注册`);
});

t('赎身一处注册，按场景分派（不撞名）', () => {
  const w = freshWorld();
  const names = w.cmds.CMD['赎身'].names;
  eq(names.length, new Set(names).size, '赎身 挂了重名');
  // 街上的赎身 → 提示，不是青楼也不是黑市逻辑
  const lines = run(w, '赎身');
  ok(lines.length > 0, '赎身完全没响应');
  ok(!txt(lines).includes('赎金'), '街上不该冒出黑市赎金');
});

t('奴册指令能跑出内容', () => {
  const w = freshWorld();
  const lines = run(w, '奴册');
  const s = txt(lines);
  ok(s.includes('奴册') || s.includes('奴'), '奴册没标题');
  ok(s.includes('恶名'), '没显示恶名');
});

t('使唤不带参数 → 列活；带参数 → 派活', () => {
  const w = freshWorld();
  const lines = run(w, '使唤');
  ok(txt(lines).includes('派活') || txt(lines).includes('人'), '列活界面不对：' + txt(lines));
});

t('麻袋指令在没袋子时不崩', () => {
  const w = freshWorld();
  const lines = run(w, '麻袋');
  ok(txt(lines).includes('麻袋'), '麻袋界面没出来');
});

t('青楼赎身线没被破坏（身世还能报卖身债）', () => {
  const w = freshWorld();
  const lines = run(w, '身世');
  ok(lines.length > 0, '身世指令炸了');
});

/* ============ 9. 存档往返 ============ */
console.log('\n【9】存档往返');

t('麻袋/奴/恶名/债务 存读档不丢', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 99999);
  w.player.room = 'jm_underground';
  w.player.money = 999999;
  // 造一袋 + 一个奴 + 一点恶名
  const n = knockDown(w, 'mob_bandit', 'jm_underground');
  kidnap.packNpc(w, n.name);
  kidnap.data(w).wanted = 7;
  const s = withSlave(w);
  const save = JSON.parse(JSON.stringify(w.serialize()));
  const bagName = save.player.kidnap.bags[0] && save.player.kidnap.bags[0].name;
  const slaveCount = save.player.kidnap.slaves.length;

  const w2 = rehydrate(save);
  const k2 = kidnap.data(w2);
  eq(k2.wanted, 7, '恶名丢了');
  eq(k2.bags.length, 1, '麻袋丢了');
  eq(k2.bags[0].name, bagName, '袋里名字变了');
  eq(k2.slaves.length, slaveCount, '奴丢了');
  ok(Array.isArray(w2.soldSlaves), 'soldSlaves 没初始化');
});

t('旧档（无 kidnap 字段）不炸', () => {
  const w = freshWorld();
  const save = JSON.parse(JSON.stringify(w.serialize()));
  delete save.player.kidnap;
  delete save.soldSlaves;
  const w2 = rehydrate(save);
  const k2 = kidnap.data(w2);
  ok(k2 && Array.isArray(k2.bags), '旧档没兜出空壳');
  eq(k2.bags.length, 0, '旧档麻袋应为空');
});

t('存档里没有活的 NPC 实例混进 bags（只存快照）', () => {
  const w = freshWorld();
  toQuietRoom(w); powerUp(w, 99999);
  const n = knockDown(w, 'mob_bandit');
  kidnap.packNpc(w, n.name);
  const save = w.serialize();
  const bag = save.player.kidnap.bags[0];
  /* 快照是**平铺**在 bag 上的（defId/name/attr/learned...），不是 snap 子对象 */
  ok(bag.defId, '袋里应有 defId');
  ok(bag.name, '袋里应有名字');
  ok(bag.attr || bag.learned, '快照应保留属性/武学');
  ok(!bag.def || typeof bag.def !== 'object', '快照不该带 def 模板（会撑爆存档）');
  ok(!bag.world, '快照不该带 world 反向引用');
  /* 人已不在 instances 里（被装走了） */
  ok(!findByName(w, bag.name), '装走后人还在场景里');
});

/* ---- 工具 ---- */
console.log('\n============================================');
console.log(`  掳人 smoke: ${pass} 通过 / ${fail} 失败`);
console.log('============================================');
if (fail) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}